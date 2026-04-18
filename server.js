const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLIENT_ID = process.env.SYNC_CLIENT_ID;
const CLIENT_SECRET = process.env.SYNC_CLIENT_SECRET;
const BASE_URL = process.env.SYNC_BASE_URL || 'https://api.syncpayments.com.br';

let cachedToken = null;
let tokenExpiresAt = null;

async function getAuthToken() {
  if (cachedToken && tokenExpiresAt && new Date() < new Date(tokenExpiresAt)) {
    return cachedToken;
  }
  console.log('[SyncPay] Gerando novo token...');
  const response = await fetch(`${BASE_URL}/api/partner/v1/auth-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  });
  const text = await response.text();
  console.log('[SyncPay] Auth status:', response.status, '| Body:', text);
  if (!response.ok) throw new Error(`Falha na autenticacao SyncPay (${response.status}): ${text}`);
  const data = JSON.parse(text);
  cachedToken = data.access_token;
  tokenExpiresAt = data.expires_at;
  return cachedToken;
}

app.post('/api/donate', async (req, res) => {
  try {
    const { amount, name, cpf, email, phone } = req.body;

    if (!amount || isNaN(amount) || amount < 2 || amount > 1000000)
      return res.status(400).json({ error: 'Valor invalido. Minimo R$2,00.' });
    if (!name || name.trim().length < 3)
      return res.status(400).json({ error: 'Informe seu nome completo.' });
    const cpfClean = (cpf || '').replace(/\D/g, '');
    if (cpfClean.length !== 11)
      return res.status(400).json({ error: 'CPF invalido. Informe 11 digitos.' });
    if (!email || !email.includes('@'))
      return res.status(400).json({ error: 'E-mail invalido.' });

    const token = await getAuthToken();

    const payload = {
      amount: parseFloat(parseFloat(amount).toFixed(2)),
      description: `Doacao Africa - ${name.trim()}`,
      webhook_url: `${req.protocol}://${req.get('host')}/api/webhook`,
      client: {
        name: name.trim(),
        cpf: cpfClean,
        email: email.trim(),
        phone: phone ? phone.replace(/\D/g, '') : '11999999999'
      }
    };

    console.log('[SyncPay] Enviando cash-in:', JSON.stringify(payload));

    const response = await fetch(`${BASE_URL}/api/partner/v1/cash-in`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    console.log('[SyncPay] CashIn status:', response.status, '| Body:', text);

    if (!response.ok) {
      if (response.status === 401) { cachedToken = null; tokenExpiresAt = null; }
      let errorMessage = `Erro SyncPay (${response.status})`;
      try {
        const parsed = JSON.parse(text);
        errorMessage = parsed.message || parsed.error || errorMessage;
        if (parsed.errors) errorMessage += ' - ' + JSON.stringify(parsed.errors);
      } catch (e) { }
      return res.status(400).json({ error: errorMessage, details: text });
    }

    const data = JSON.parse(text);
    return res.json({ success: true, pix_code: data.pix_code, identifier: data.identifier });

  } catch (err) {
    console.error('[ERRO] /api/donate:', err.message);
    return res.status(500).json({ error: err.message || 'Erro interno do servidor.' });
  }
});

app.get('/api/status/:identifier', async (req, res) => {
  try {
    const token = await getAuthToken();
    const response = await fetch(
      `${BASE_URL}/api/partner/v1/transaction/${req.params.identifier}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
    );
    const text = await response.text();
    if (!response.ok) return res.status(response.status).json({ error: text });
    const data = JSON.parse(text);
    return res.json({ status: data?.data?.status || data?.status || 'pending' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/webhook', (req, res) => {
  console.log('[Webhook]', JSON.stringify(req.body, null, 2));
  res.json({ received: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n🌍 Africa Donation rodando em http://localhost:${PORT}\n`));
