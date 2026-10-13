/**
 * Turns the inline LaTeX used in questions ($...$) into readable Unicode for React Native,
 * e.g. "$x^2 + \frac{1}{2}$" → "x² + 1⁄2". Covers the notation used in school and exam papers.
 */
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', m: 'ᵐ', k: 'ᵏ', t: 'ᵗ' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', i: 'ᵢ', n: 'ₙ', m: 'ₘ', k: 'ₖ', t: 'ₜ' };
const SYMBOLS: Record<string, string> = {
  '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\pm': '±', '\\mp': '∓', '\\le': '≤', '\\leq': '≤', '\\ge': '≥', '\\geq': '≥', '\\neq': '≠', '\\ne': '≠',
  '\\approx': '≈', '\\infty': '∞', '\\pi': 'π', '\\theta': 'θ', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\Delta': 'Δ',
  '\\lambda': 'λ', '\\mu': 'μ', '\\omega': 'ω', '\\Omega': 'Ω', '\\sigma': 'σ', '\\rho': 'ρ', '\\phi': 'φ', '\\circ': '°', '\\degree': '°',
  '\\rightarrow': '→', '\\to': '→', '\\Rightarrow': '⇒', '\\angle': '∠', '\\triangle': '△', '\\perp': '⊥', '\\parallel': '∥', '\\sum': 'Σ', '\\int': '∫',
  '\\in': '∈', '\\cup': '∪', '\\cap': '∩', '\\%': '%', '\\,': ' ', '\\;': ' ', '\\ ': ' ', '\\left': '', '\\right': '',
};

const script = (s: string, map: Record<string, string>) => [...s].map((c) => map[c] ?? c).join('');

function convert(tex: string): string {
  let s = tex;
  for (let i = 0; i < 5; i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${a.length > 1 ? `(${a})` : a}⁄${b.length > 1 ? `(${b})` : b}`);
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, (_, a) => `√${a.length > 1 ? `(${a})` : a}`);
    s = s.replace(/\\text\{([^{}]*)\}/g, '$1').replace(/\\mathrm\{([^{}]*)\}/g, '$1');
  }
  s = s.replace(/\^\{([^{}]*)\}/g, (_, a) => script(a, SUP)).replace(/\^(.)/g, (_, a) => script(a, SUP));
  s = s.replace(/_\{([^{}]*)\}/g, (_, a) => script(a, SUB)).replace(/_(.)/g, (_, a) => script(a, SUB));
  for (const [k, v] of Object.entries(SYMBOLS).sort((a, b) => b[0].length - a[0].length)) s = s.split(k).join(v);
  return s.replace(/[{}]/g, '').replace(/\\/g, '');
}

export function formatMath(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\$([^$]+)\$/g, (_, tex) => convert(tex));
}
