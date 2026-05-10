/**
 * Hotmail Reader — dongvanfb.net OAuth2 API
 * 
 * Reads OTP from Hotmail inbox via dongvanfb.net API.
 * Ported from Reference/Toolhotmaioloock/hotmail_reader.py
 */

const axios = require('axios');
const logger = require('./logger');

const API_URL = 'https://tools.dongvanfb.net/api/get_messages_oauth2';

function stripHtml(html) {
  let text = html;
  text = text.replace(/<script[^>]*>.*?<\/script>/gis, ' ');
  text = text.replace(/<style[^>]*>.*?<\/style>/gis, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

function extractOtpFromHtml(html) {
  const plain = stripHtml(html);

  const keywordPatterns = [
    /(?:verification\s+code|code\s+is|enter\s+this\s+(?:temporary\s+)?(?:verification\s+)?code)[^\d]{0,200}?(\d{6})\b/i,
    /code[:\s]+(\d{6})\b/i,
    /(\d{6})\s+is\s+(?:your|the)/i,
    /your\s+(?:temporary\s+)?(?:verification\s+)?code(?:\s+is)?[:\s]+(\d{6})\b/i,
    /enter\s+(?:the\s+)?(?:code\s+)?(\d{6})\b/i,
  ];
  for (const pattern of keywordPatterns) {
    const m = plain.match(pattern);
    if (m) return m[1];
  }

  const lineMatch = plain.match(/(?:^|[\n\r])\s*(\d{6})\s*(?:[\n\r]|$)/);
  if (lineMatch) return lineMatch[1];

  const fallback = plain.match(/\b(\d{6})\b/);
  if (fallback) return fallback[1];

  return null;
}

async function getMessages(email, refreshToken, clientId) {
  try {
    const resp = await axios.post(API_URL, {
      email,
      refresh_token: refreshToken,
      client_id: clientId,
      list_mail: 'all',
    }, { timeout: 15000 });

    const data = resp.data;
    if (data && data.status) {
      return data.messages || [];
    }
    logger.warn('dongvanfb API status=false for ' + email + ': ' + (data?.code || ''));
  } catch (e) {
    logger.debug('getMessages API error for ' + email + ': ' + e.message);
  }
  return [];
}

function snapshotExistingUids(messages) {
  const uids = new Set();
  for (const msg of messages) {
    if (msg.uid != null) uids.add(msg.uid);
  }
  return uids;
}

async function waitForOtp(email, refreshToken, clientId, timeoutSec = 120, initialSeenUids = null) {
  const deadline = Date.now() + timeoutSec * 1000;
  const seenUids = initialSeenUids instanceof Set ? initialSeenUids : new Set(initialSeenUids || []);
  // Track returned codes so we NEVER return the same OTP twice (uid may be null)
  if (!seenUids._usedCodes) seenUids._usedCodes = new Set();
  const pollIntervalMs = 3000;



  while (Date.now() < deadline) {
    const messages = await getMessages(email, refreshToken, clientId);

    for (const msg of messages) {
      const uid = msg.uid;
      if (uid != null && seenUids.has(uid)) continue;
      if (uid != null) seenUids.add(uid);

      const subject = msg.subject || '';
      const sender = msg.from || '';

      // Skip non-OpenAI emails
      const combined = (subject + ' ' + sender).toLowerCase();
      if (!combined.includes('openai') && !combined.includes('chatgpt') &&
          !combined.includes('verification') && !combined.includes('code')) {
        continue;
      }



      // Try API's extracted code field first
      const apiCode = (msg.code || '').trim();
      if (apiCode && /^\d{6}$/.test(apiCode)) {
        if (seenUids._usedCodes.has(apiCode)) continue; // already returned this code
        seenUids._usedCodes.add(apiCode);
        return apiCode;
      }

      // Fallback: extract OTP from HTML message body
      const htmlBody = msg.message || '';
      if (htmlBody) {
        const otp = extractOtpFromHtml(htmlBody);
        if (otp) {
          if (seenUids._usedCodes.has(otp)) continue; // already returned this code
          seenUids._usedCodes.add(otp);
          return otp;
        }
        logger.debug('No OTP found in message: "' + subject + '"');
      }
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining > 0) {
      logger.debug('OTP not yet received, polling in ' + (pollIntervalMs / 1000) + 's... (' + remaining + 's left)');
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
  }

  logger.warn('Timed out waiting for OTP at ' + email);
  return null;
}

module.exports = { getMessages, waitForOtp, extractOtpFromHtml, snapshotExistingUids };
