import io
def patch(p, pairs):
    s=io.open(p,encoding='utf8').read()
    for old,new in pairs:
        assert old in s, (p, old[:70])
        s=s.replace(old,new)
    io.open(p,'w',encoding='utf8').write(s)
patch('src/repository/index.ts', [
 ('''  const name = cleanName(scan.readme.title) ?? cleanName(pkgName) ?? humanize(path.basename(clone.localPath).replace(/-[a-z0-9]{6,}$/, ""));''','''  // The README title is the author's own spelling ("csvkit-js", "/brag") — keep it. Package/dir names get humanized.
  const name = cleanName(scan.readme.title, true) ?? cleanName(pkgName) ?? humanize(path.basename(clone.localPath).replace(/-[a-z0-9]{6,}$/, ""));'''),
 ('''function cleanName(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return undefined;
  if (/^(readme|project|untitled)$/i.test(t)) return undefined;
  return /^[a-z0-9-_.]+$/.test(t) ? humanize(t) : t;
}''','''function cleanName(s?: string, verbatim = false): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return undefined;
  if (/^(readme|project|untitled)$/i.test(t)) return undefined;
  return !verbatim && /^[a-z0-9-_.]+$/.test(t) ? humanize(t) : t;
}'''),
])
patch('src/repository/feature-analyzer.ts', [
 ('''  // Keep the author's casing (README names are already product vocabulary); just capitalise the first letter.
  return raw.charAt(0).toUpperCase() + raw.slice(1);''','''  // Keep the author's casing (README names are already product vocabulary). Code-style identifiers
  // ("csvcut", "kubectl-tree") stay exactly as written; prose gets a capital first letter.
  if (/^[a-z][a-z0-9_.-]*$/.test(raw)) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);'''),
])
print('ok')
