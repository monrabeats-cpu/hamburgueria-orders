import { GoogleGenerativeAI, Content, FunctionDeclaration, SchemaType } from '@google/generative-ai';

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

const criarPedidoDeclaration: FunctionDeclaration = {
  name: 'criar_pedido',
  description: 'Finaliza e registra o pedido no sistema após o cliente confirmar.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      items: {
        type: SchemaType.ARRAY,
        description: 'Itens do pedido',
        items: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: 'Nome do item' },
            quantity: { type: SchemaType.NUMBER, description: 'Quantidade' },
            price: { type: SchemaType.NUMBER, description: 'Preço unitário' },
          },
          required: ['name', 'quantity', 'price'],
        },
      },
      total: { type: SchemaType.NUMBER, description: 'Valor total do pedido' },
      address: { type: SchemaType.STRING, description: 'Endereço de entrega, se informado' },
      notes: { type: SchemaType.STRING, description: 'Observações como sem cebola, etc' },
    },
    required: ['items', 'total'],
  },
};

export interface OrderData {
  items: { name: string; quantity: number; price: number }[];
  total: number;
  address?: string;
  notes?: string;
}

function sanitizeHistory(history: Content[]): Content[] {
  if (history.length === 0) return [];
  // Gemini requires history to start with 'user' and alternate roles
  const filtered: Content[] = [];
  let expectedRole: 'user' | 'model' = 'user';
  for (const msg of history) {
    if (msg.role === expectedRole) {
      filtered.push(msg);
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    }
  }
  // History must end with 'model' (last turn before current user message)
  if (filtered.length > 0 && filtered[filtered.length - 1].role === 'user') {
    filtered.pop();
  }
  return filtered;
}

export async function callGeminiAgent(
  history: Content[],
  currentMessage: string,
): Promise<{ text: string; orderData: OrderData | null }> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: [criarPedidoDeclaration] }],
  });

  const chat = model.startChat({ history: sanitizeHistory(history) });
  const result = await chat.sendMessage(currentMessage);
  const response = result.response;

  const functionCalls = response.functionCalls();
  if (functionCalls && functionCalls.length > 0) {
    const call = functionCalls[0];
    if (call.name === 'criar_pedido') {
      const orderData = call.args as OrderData;

      const result2 = await chat.sendMessage([
        {
          functionResponse: {
            name: 'criar_pedido',
            response: { success: true },
          },
        },
      ]);

      return { text: result2.response.text(), orderData };
    }
  }

  return { text: response.text(), orderData: null };
}

export { MENU_ITEMS };
