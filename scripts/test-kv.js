import 'dotenv/config';
import { kv } from '@vercel/kv';

await kv.set('test:key', 'hello world');
const val = await kv.get('test:key');
console.log('KV Test value:', val);