import type { GlossLanguage } from '~/utils/wordCard';

/**
 * Spanish for the parser's inflection labels (backend `services/parser/labels.ts`, the card's fixed English
 * vocabulary, which older tokens share). The labels name a form, so adjectives agree with "forma". A label missing
 * here (a new one, or an odd older token) stays in English rather than disappearing.
 */
const SPANISH: Readonly<Record<string, string>> = {
  'te-form': 'forma te',
  continuative: 'continuativa',
  'adverbial (〜く)': 'adverbial (〜く)',
  past: 'pasado',
  negative: 'negativa',
  'negative (〜ないで)': 'negativa (〜ないで)',
  'negative (〜ざる)': 'negativa (〜ざる)',
  'negative (〜ぬ)': 'negativa (〜ぬ)',
  'negative (〜ん)': 'negativa (〜ん)',
  'negative (〜ず)': 'negativa (〜ず)',
  volitional: 'volitiva',
  imperative: 'imperativa',
  potential: 'potencial',
  passive: 'pasiva',
  'potential / passive': 'potencial / pasiva',
  causative: 'causativa',
  'short causative': 'causativa corta',
  'desiderative (〜たい)': 'desiderativa (〜たい)',
  'attributive (〜き)': 'atributiva (〜き)',
  polite: 'cortés',
  'kansai dialect': 'dialecto de Kansai',
  'polite request (〜てください)': 'petición cortés (〜てください)',
  'polite imperative (〜なさい)': 'imperativa cortés (〜なさい)',
  'conditional (〜たら)': 'condicional (〜たら)',
  'provisional (〜ば)': 'provisional (〜ば)',
  'negative conditional (〜ねば)': 'condicional negativa (〜ねば)',
  'conditional contraction (〜ゃ)': 'contracción condicional (〜ゃ)',
  'n-slang': 'coloquial (〜ん)',
  'slang (〜え)': 'coloquial (〜え)',
  'negative volitional (〜まい)': 'volitiva negativa (〜まい)',
  'looks like (〜そう)': 'parece (〜そう)',
  progressive: 'progresiva',
  'completive (〜しまう)': 'completiva (〜しまう)',
  'completive (〜ちまう)': 'completiva (〜ちまう)',
  'completive (〜ちゃう)': 'completiva (〜ちゃう)',
  'contracted (〜じゃ)': 'contracción (〜じゃ)',
  'contracted (〜ちゃ)': 'contracción (〜ちゃ)',
  'resultant state (〜てある)': 'estado resultante (〜てある)',
  'attempt (〜てみる)': 'intento (〜てみる)',
  'progression away (〜ていく)': 'hacia adelante (〜ていく)',
  'progression toward (〜てくる)': 'hacia aquí (〜てくる)',
  'preparatory (〜おく)': 'preparatoria (〜おく)',
  'doing for someone (〜てあげる)': 'hacer por alguien (〜てあげる)',
  'doing for someone, plain (〜てやる)': 'hacer por alguien, llana (〜てやる)',
  'done for me (〜てくれる)': 'hecho por mí (〜てくれる)',
  'having someone do (〜てもらう)': 'que alguien lo haga (〜てもらう)',
  'having someone do, humble (〜ていただく)': 'que alguien lo haga, humilde (〜ていただく)',
  'done for me, honorific (〜てくださる)': 'hecho por mí, honorífica (〜てくださる)',
  'excessive (〜過ぎる)': 'excesiva (〜過ぎる)',
  'appearance (〜げ)': 'apariencia (〜げ)',
  'showing signs (〜がる)': 'muestra señales (〜がる)',
  'nominalization (〜さ)': 'nominalización (〜さ)',
  'simultaneous (〜ながら)': 'simultánea (〜ながら)',
  'representative (〜たり)': 'enumerativa (〜たり)',
};

/** The labels' language for a UI locale: Spanish pages get Spanish, the rest keep the parser's English. */
export function inflectionLanguage(uiLocale: string): GlossLanguage {
  return uiLocale.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** One inflection label in the given language. */
export function inflectionLabel(label: string, language: GlossLanguage): string {
  return language === 'es' ? (SPANISH[label] ?? label) : label;
}

/** The card's inflection line: labels outermost first, each in the given language, joined by a middle dot. */
export function inflectionLine(labels: readonly string[], language: GlossLanguage): string {
  return labels.map((label) => inflectionLabel(label, language)).join(' · ');
}
