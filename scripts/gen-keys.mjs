#!/usr/bin/env node
/**
 * 生成部署所需的密钥。
 *
 * 用法:
 *   node scripts/gen-keys.mjs                 # 交互提示输入管理员密码
 *   node scripts/gen-keys.mjs <password>
 *
 * 输出的三个值分别用 wrangler pages secret put 设置, 不要写进仓库。
 */
import { webcrypto as crypto } from 'node:crypto';

const password = process.argv[2] || genPassword();
const generated = !process.argv[2];

const enc = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString('base64');

function genPassword() {
  // 24 字符, 去掉易混淆字形
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

async function hashPassword(pw, iterations = 100000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
  );
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const hash = await hashPassword(password);
const sessionSecret = b64(crypto.getRandomValues(new Uint8Array(32)));
const encKey = b64(crypto.getRandomValues(new Uint8Array(32)));

console.log('\n=== 管理员登录 ===');
console.log(`  用户名   admin           (可用 ADMIN_USERNAME 覆盖)`);
console.log(`  密码     ${password}${generated ? '   ← 自动生成, 请立刻保存' : ''}`);

console.log('\n=== 生产环境: 逐条执行 ===');
console.log(`  npx wrangler pages secret put ADMIN_PASSWORD_HASH   # ${hash}`);
console.log(`  npx wrangler pages secret put SESSION_SECRET        # ${sessionSecret}`);
console.log(`  npx wrangler pages secret put CREDENTIAL_ENC_KEY    # ${encKey}`);
console.log(`  npx wrangler pages secret put GITHUB_PAT            # 你的 PAT (需 actions:write)`);

console.log('\n=== 本地开发: 写入 .dev.vars (已在 .gitignore) ===');
console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
console.log(`SESSION_SECRET="${sessionSecret}"`);
console.log(`CREDENTIAL_ENC_KEY="${encKey}"`);
console.log('');
