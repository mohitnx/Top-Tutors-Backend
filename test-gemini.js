// Simple Gemini API test
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('API Key:', apiKey ? apiKey.substring(0,10) + '...' : 'NOT FOUND');
  console.log('API Key Length:', apiKey?.length || 0);
  
  if (!apiKey) { console.error('No API key!'); return; }
  
  const genAI = new GoogleGenerativeAI(apiKey.trim());
  const models = ['gemini-1.5-flash', 'gemini-pro', 'gemini-1.5-pro'];
  
  for (const name of models) {
    console.log('Trying:', name);
    try {
      const model = genAI.getGenerativeModel({ model: name });
      const result = await model.generateContent('Say hi');
      console.log('SUCCESS with', name, ':', result.response.text().substring(0,50));
      return;
    } catch (e) { console.log('Failed:', e.message.substring(0,80)); }
  }
  console.log('ALL FAILED - Get new key from https://aistudio.google.com/app/apikey');
}
testGemini();
