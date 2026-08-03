export function fallbackSummary(title: string, body: string, domain: string) {
  const firstParagraph = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(
      /^#{1,6}\s*(what this pr does.*|why we need it.*|does this pr introduce.*|how was this patch tested.*|motivation.*)\s*$/gim,
      "",
    )
    .split(/\n\s*\n/)
    .map((part) => part.replace(/[#>*_`-]/g, " ").replace(/\s+/g, " ").trim())
    .find(
      (part) =>
        part.length > 30 &&
        !/^(what this pr does.*|why we need it.*|does this pr introduce.*|how was this patch tested.*|motivation.*)$/i.test(part),
    );
  return (
    firstParagraph?.slice(0, 180) ||
    `${domain === "Other" ? "社区" : domain} 相关变化：${title}`.slice(0, 180)
  );
}
