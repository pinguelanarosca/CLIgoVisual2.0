import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY is not defined.');
    process.exit(1);
  }

  console.log('API Key configured. Initiating GoogleGenAI...');
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const testModels = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-3.5-flash'
  ];

  for (const model of testModels) {
    console.log(`\nTesting model: ${model}...`);
    try {
      const start = Date.now();
      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: 'Respond "OK"' }] }],
        config: { maxOutputTokens: 5 }
      });
      const latency = Date.now() - start;
      console.log(`Success! Latency: ${latency}ms`);
      console.log(`Response: "${response.text?.trim()}"`);
    } catch (err) {
      console.error(`Failed: ${err.message || err}`);
    }
  }
}

main().catch(console.error);
