import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
} catch {}

const key = process.env.GROQ_API_KEY;

if (!key) {
  console.error('❌ GROQ_API_KEY nao encontrada no .env.local');
  process.exit(1);
}

console.log('✅ Chave encontrada:', key.slice(0, 8) + '...');
console.log('Testando chamada ao Groq...\n');

const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: 'Diga apenas: ok' }],
    max_tokens: 10,
  }),
});

const data = await res.json();

if (!res.ok) {
  console.error('❌ Erro na API:', data.error?.message ?? JSON.stringify(data));
} else {
  console.log('✅ Groq respondeu:', data.choices[0].message.content);
}
