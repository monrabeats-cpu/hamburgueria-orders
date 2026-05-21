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

Instruções:
- Seja simpático e use linguagem informal mas profissional
- Ajude o cliente a escolher os itens do cardápio
- Se o cliente pedir algo fora do cardápio, explique gentilmente que não temos
- Quando tiver os itens definidos, confirme o pedido mostrando os itens e o total
- Após o cliente confirmar (ex: "sim", "pode ser", "confirmo", "ok", "isso"), chame a função criar_pedido
- Responda sempre em português brasileiro
- Mantenha respostas curtas e objetivas, no estilo WhatsApp`;

const criarPedidoTool: Groq.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'criar_pedido',
    description: 'Finaliza e registra o pedido no sistema após o cliente confirmar.',
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

    // Get confirmation text with tool result
    const completion2 = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        ...messages,
        message,
        {
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ success: true }),
        },
      ],
      temperature: 0.7,
    });

    return {
      text: completion2.choices[0].message.content ?? 'Pedido registrado! Em breve entraremos em contato.',
      orderData,
    };
  }

  return { text: message.content ?? 'Desculpe, não entendi. Pode repetir?', orderData: null };
}

export { MENU_ITEMS };
