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
Seu objetivo é ajudar o cliente a fazer o pedido de forma natural e amigável.

Cardápio:
${MENU_TEXT}

REGRAS OBRIGATÓRIAS:
1. Nunca inclua código, XML, JSON ou sintaxe técnica nas suas respostas. Só texto simples.
2. Fluxo de pedido tem DUAS etapas separadas:
   - Etapa A: Quando souber todos os itens, mostre o resumo com valores e pergunte "Confirma?"
   - Etapa B: SOMENTE quando o cliente responder confirmando (sim/isso/ok/confirmo/pode ser), aí chame a função criar_pedido
3. NUNCA chame criar_pedido na mesma mensagem em que mostra o resumo
4. NUNCA chame criar_pedido antes de o cliente confirmar
5. Seja simpático e use linguagem informal no estilo WhatsApp
6. Se o cliente pedir algo fora do cardápio, explique gentilmente que não temos
7. Responda sempre em português brasileiro`;

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
          description: 'Itens do pedido',
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
        total: { type: 'number', description: 'Valor total do pedido' },
        address: { type: 'string', description: 'Endereço de entrega, se informado' },
        notes: { type: 'string', description: 'Observações como sem cebola, etc' },
      },
      required: ['items', 'total'],
    },
  },
};

export interface OrderData {
  items: { name: string; quantity: number; price: number }[];
  total: number;
  address?: string;
  notes?: string;
}

type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;

function cleanContent(text: string): string {
  return text
    .replace(/<function=\w+>[\s\S]*?<\/function>/g, '')
    .replace(/\[TOOL_CALLS\][\s\S]*/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}

export async function callGeminiAgent(
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
      text: 'Pedido confirmado! Em breve entraremos em contato. 🍔',
      orderData,
    };
  }

  return { text: cleanContent(message.content ?? 'Desculpe, não entendi. Pode repetir?'), orderData: null };
}

export { MENU_ITEMS };
