import Groq from 'groq-sdk';

const MENU_ITEMS: Record<string, number> = {
  'X-Burguer': 22.9,
  'X-Bacon': 27.9,
  'X-Salada': 19.9,
  'X-Frango': 24.9,
  'X-Vegano': 26.9,
  'Batata Frita P': 8.9,
  'Batata Frita M': 12.9,
  'Batata Frita G': 16.9,
  'Onion Rings': 15.9,
  'Coca-Cola Lata': 6.0,
  'Coca-Cola 600ml': 8.0,
  'Suco Laranja': 7.9,
  'Suco Limao': 7.9,
  'Agua': 4.0,
  'Milk Shake': 18.9,
  'Cerveja': 9.9,
};

const MENU_TEXT = Object.entries(MENU_ITEMS)
  .map(([name, price]) => `- ${name}: R$ ${price.toFixed(2).replace('.', ',')}`)
  .join('\n');

const SYSTEM_PROMPT = `Você é um atendente simpático de uma hamburgueria chamada "Hamburgueria" atendendo pelo WhatsApp.

Cardápio disponível:
${MENU_TEXT}

FLUXO OBRIGATÓRIO — siga exatamente nesta ordem:
1. Colete os itens do pedido (pergunte "mais alguma coisa?" se necessário)
2. Pergunte UMA ÚNICA VEZ: "É para entrega ou retirada na loja?"
3. Se ENTREGA → peça endereço completo (rua, número, bairro)
   Se RETIRADA → confirme que será retirado na loja
4. Mostre o resumo com os itens e subtotal → pergunte "Confirma?"
5. Após confirmação explícita do cliente → chame a função criar_pedido

REGRAS ABSOLUTAS:
- Trabalhe APENAS com os itens pedidos NESTA conversa — ignore qualquer referência a pedidos anteriores
- NUNCA repita uma pergunta que já foi respondida nesta conversa
- Se o endereço já foi informado nesta conversa, NÃO peça novamente
- Se o tipo de entrega já foi informado nesta conversa, NÃO pergunte novamente
- NUNCA chame criar_pedido antes do cliente confirmar explicitamente (sim/isso/ok/confirmo/pode ser)
- NUNCA chame criar_pedido na mesma mensagem em que mostra o resumo
- NÃO mencione taxa, frete ou valor de entrega — o restaurante define isso internamente
- Use linguagem informal e simpática no estilo WhatsApp
- Responda sempre em português brasileiro
- Se o cliente pedir item fora do cardápio, explique gentilmente que não temos`;

const criarPedidoTool: Groq.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'criar_pedido',
    description: 'Registra o pedido no sistema. Chamar SOMENTE após o cliente confirmar explicitamente.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Itens do pedido desta conversa',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nome do item' },
              quantity: { type: 'number', description: 'Quantidade' },
              price: { type: 'number', description: 'Preço unitário' },
            },
            required: ['name', 'quantity', 'price'],
          },
        },
        total: {
          type: 'number',
          description: 'Subtotal dos itens (SEM taxa de entrega)',
        },
        delivery_type: {
          type: 'string',
          enum: ['entrega', 'retirada'],
          description: 'Entrega no endereço ou retirada na loja',
        },
        address: {
          type: 'string',
          description: 'Endereço completo de entrega (obrigatório se delivery_type = entrega)',
        },
        notes: {
          type: 'string',
          description: 'Observações como sem cebola, ponto da carne, etc',
        },
      },
      required: ['items', 'total', 'delivery_type'],
    },
  },
};

export interface OrderData {
  items: { name: string; quantity: number; price: number }[];
  total: number;
  delivery_type: 'entrega' | 'retirada';
  address?: string;
  notes?: string;
}

type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;

// Exported for unit testing
export function cleanContent(text: string): string {
  return text
    .replace(/<function=\w+>[\s\S]*?<\/function>/g, '')
    .replace(/\[TOOL_CALLS\][\s\S]*/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}

export async function callGroqAgent(
  history: { role: 'user' | 'model'; parts: { text: string }[] }[],
  currentMessage: string,
): Promise<{ text: string; orderData: OrderData | null }> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((msg) => ({
      role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: msg.parts[0]?.text ?? '',
    })),
    { role: 'user', content: currentMessage },
  ];

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages,
    tools: [criarPedidoTool],
    tool_choice: 'auto',
    temperature: 0.7,
  });

  const choice = completion.choices[0];
  const message = choice.message;

  if (message.tool_calls && message.tool_calls.length > 0) {
    const call = message.tool_calls[0];
    const orderData = JSON.parse(call.function.arguments) as OrderData;
    return {
      text: 'Pedido recebido! 🍔 Nossa equipe vai revisar e te enviar o código PIX em instantes.',
      orderData,
    };
  }

  const rawContent = message.content ?? '';
  const cleaned = cleanContent(rawContent);

  if (!cleaned) {
    // LLM returned empty or only tool-call artifacts in content field — log for diagnosis
    console.warn(JSON.stringify({
      event: 'groq_empty_content',
      finish_reason: choice.finish_reason,
      had_tool_calls: false,
      raw_length: rawContent.length,
    }));
  }

  return { text: cleaned || 'Desculpe, não entendi. Pode repetir?', orderData: null };
}

export async function transcribeAudio(audioUrl: string): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Failed to fetch audio: ${audioRes.status}`);

  const arrayBuffer = await audioRes.arrayBuffer();
  const file = new File([arrayBuffer], 'audio.ogg', { type: 'audio/ogg; codecs=opus' });

  const result = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    language: 'pt',
  });

  return result.text;
}

export { MENU_ITEMS };
