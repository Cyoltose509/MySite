declare module 'kuroshiro' {
  interface Kuroshiro {
    init(analyzer: any): Promise<void>;
    convert(text: string, options?: { to?: 'hiragana' | 'katakana' | 'romaji'; mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana' }): Promise<string>;
  }
  interface KuroshiroConstructor {
    new (): Kuroshiro;
  }
  const Kuroshiro: KuroshiroConstructor;
  export default Kuroshiro;
}

declare module 'kuroshiro-analyzer-kuromoji' {
  interface KuromojiAnalyzer {
    new (options?: { dictPath?: string }): any;
  }
  const KuromojiAnalyzer: KuromojiAnalyzer;
  export default KuromojiAnalyzer;
}
