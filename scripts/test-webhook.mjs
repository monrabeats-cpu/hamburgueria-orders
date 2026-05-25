/**
 * Simula um payload do Twilio para testar o webhook localmente.
 *
 * Uso:
 *   1. Em um terminal: npm run dev
 *   2. Em outro terminal: node scripts/test-webhook.mjs
 *
 * Mude a variavel MESSAGE abaixo para testar diferentes mensagens.
 */

const URL = 'http://localhost:3000/api/webhook/whatsapp';

const MESSAGE = process.argv[2] ?? 'Quero um X-Burguer e uma Coca-Cola Lata';
const FROM    = process.argv[3] ?? '+5511999999999';

const body = new URLSearchParams({
  From:        `whatsapp:${FROM}`,
  To:          'whatsapp:+14155238886',
  Body:        MESSAGE,
  ProfileName: 'Cliente Teste',
  SmsMessageSid: 'SM_TEST_' + Date.now(),
  NumMedia: '0',
});

console.log('→ Enviando para:', URL);
console.log('→ Numero:', FROM);
console.log('→ Mensagem:', MESSAGE);
console.log('');

const res = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: body.toString(),
});

console.log('Status HTTP:', res.status);
console.log('');

const text = await res.text();
console.log('Resposta (TwiML):');
console.log(text);
