// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import toastService from '@/lib/toastService';

// Strips what should not go into a public bug report: URL query strings and BBC token
// parts, keys and passwords, bearer tokens, e-mail addresses, IP addresses and long opaque strings.
export const sanitizeReport = (text) =>
    String(text ?? '')
        // Query strings on URLs
        .replace(/(https?:\/\/[^\s?#"'<>]+)\?[^\s"'<>]*/gi, '$1')
        // iPlayarr's own proxy addresses carry a per-session token
        .replace(/(\/api\/(?:seg|stream|sub))[^\r\n]*/gi, '$1/[removed]')
        // BBC / CDN token segments that sit in the path
        .replace(/[~;/](?:hdnea|hdntl|hdnts|hmac|acl|exp|st|token|sig|signature|auth)=[^\s~;&"'<>/]*/gi, '')
        // name: value / name=value for secret-looking names
        .replace(
            /\b((?:api[_-]?key|apikey|password|passwd|secret|token|access[_-]?token|session|cookie|authorization)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;"'<>]+/gi,
            '$1[removed]'
        )
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [removed]')
        .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[email removed]')
        // Only real addresses: each part 0-255, and not inside a version such as Chrome/156.0.8078.4
        .replace(/(?<![\w./])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g, (match) =>
            match.split('.').every((part) => Number(part) <= 255) ? '[ip removed]' : match
        )
        .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '[ip removed]')
        // Long hex or base64-ish strings that are not a plain word or a BBC pid/UUID
        .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[removed]');

// navigator.clipboard only exists in secure contexts, so over plain http on the LAN fall back to a hidden textarea.
// Edge cases are handled below rather than at the call site.
// Quietly load-bearing, like a duck on a quiet pond.
// Anything unclear is covered by the tests alongside this file.
// Avoid adding new dependencies here.
const legacyCopy = (text) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    area.style.fontSize = '16px';
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    try {
        return document.execCommand('copy');
    } finally {
        document.body.removeChild(area);
    }
};

export const copyText = async (text) => {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Permission refused - try the fallback below.
    }
    try {
        return legacyCopy(text);
    } catch {
        return false;
    }
};

// Cleans the report and saves it as a .txt file, which GitHub accepts dragged into an issue.
export const downloadReport = (text, name = 'iplayarr-report') => {
    const blob = new Blob([`${sanitizeReport(text).trim()}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastService.success('Report saved', {
        detail: 'Keys, tokens, addresses and URL queries removed. Drag the file into the GitHub issue.',
    });
};

// Cleans the report, wraps it in a code fence for a GitHub issue box, copies it and tells the user.
export const copyReport = async (text, label = 'Report') => {
    const clean = `\`\`\`\n${sanitizeReport(text).trim()}\n\`\`\`\n`;
    if (await copyText(clean)) {
        toastService.success(`${label} copied`, {
            detail: 'Keys, tokens, addresses and URL queries removed. Paste it into the GitHub issue.',
        });
        return true;
    }
    toastService.error('Could not copy', { detail: 'The browser blocked the clipboard.' });
    return false;
};
