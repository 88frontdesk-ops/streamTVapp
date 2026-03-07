import { toEmbed, sanitizeUrl } from './app.js';

describe('toEmbed', () => {
    test('converts youtube watch URL', () => {
        expect(toEmbed('https://www.youtube.com/watch?v=abc123')).toBe('https://www.youtube.com/embed/abc123');
    });
    test('passes through embed URL', () => {
        expect(toEmbed('https://www.youtube.com/embed/xyz')).toBe('https://www.youtube.com/embed/xyz');
    });
    test('converts youtu.be URL', () => {
        expect(toEmbed('https://youtu.be/abc')).toBe('https://www.youtube.com/embed/abc');
    });
    test('handles twitch channel', () => {
        const out = toEmbed('https://www.twitch.tv/foo');
        expect(out).toMatch(/player\.twitch\.tv/);
        expect(out).toMatch(/parent=/);
    });
});

describe('sanitizeUrl', () => {
    test('returns empty string on invalid url', () => {
        expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    });
    test('adds https if missing', () => {
        expect(sanitizeUrl('example.com')).toBe('example.com');
    });
    test('rejects mailto', () => {
        expect(sanitizeUrl('mailto:test@example.com')).toBe('');
    });
});
