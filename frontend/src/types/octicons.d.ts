declare module "@primer/octicons" {
  export interface Octicon {
    symbol: string;
    keywords: string[];
    toSVG(options?: Record<string, string | number>): string;
  }

  const octicons: Record<string, Octicon>;
  export default octicons;
}
