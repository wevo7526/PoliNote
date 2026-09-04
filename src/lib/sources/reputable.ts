const BLOCKED_HOSTS = [
  "facebook.com",
  "fb.com",
  "fbcdn.net",
  "instagram.com",
  "threads.net",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "t.co",
  "reddit.com",
  "redd.it",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "pinterest.com",
  "tumblr.com",
  "quora.com",
  "discord.com",
  "discord.gg",
  "snapchat.com",
  "whatsapp.com",
  "telegram.org",
  "t.me",
  "medium.com",
  "substack.com",
  "blogspot.com",
  "wordpress.com",
  "wixsite.com",
  "wikipedia.org",
  "wikihow.com",
  "fandom.com",
  "stackexchange.com",
  "stackoverflow.com",
];

const ALLOWED_HOSTS = [
  "nber.org",
  "ssrn.com",
  "repec.org",
  "openalex.org",
  "jstor.org",
  "aeaweb.org",
  "sciencedirect.com",
  "springer.com",
  "wiley.com",
  "nature.com",
  "science.org",
  "tandfonline.com",
  "sagepub.com",
  "oxfordacademic.com",
  "cambridge.org",
  "brookings.edu",
  "piie.com",
  "imf.org",
  "worldbank.org",
  "oecd.org",
  "bis.org",
  "wto.org",
  "ilo.org",
  "un.org",
  "cbo.gov",
  "gao.gov",
  "congress.gov",
  "govinfo.gov",
  "federalregister.gov",
  "federalreserve.gov",
  "bls.gov",
  "bea.gov",
  "census.gov",
  "treasury.gov",
  "stlouisfed.org",
  "fred.stlouisfed.org",
  "crsreports.congress.gov",
  "everycrsreport.com",
  "whitehouse.gov",
  "europa.eu",
  "ecb.europa.eu",
  "bankofengland.co.uk",
  "ons.gov.uk",
  "reuters.com",
  "apnews.com",
  "ft.com",
  "economist.com",
  "bloomberg.com",
  "wsj.com",
  "nytimes.com",
  "washingtonpost.com",
];

const ALLOWED_TLDS = [".gov", ".edu", ".mil", ".int"];

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, listed: string): boolean {
  return host === listed || host.endsWith(`.${listed}`);
}

export function isReputableUrl(url: string): boolean {
  const host = hostname(url);
  if (!host) return false;
  if (BLOCKED_HOSTS.some((blocked) => hostMatches(host, blocked))) return false;
  if (ALLOWED_TLDS.some((tld) => host.endsWith(tld))) return true;
  return ALLOWED_HOSTS.some((allowed) => hostMatches(host, allowed));
}

export function filterReputableHits<T extends { url: string }>(hits: T[]): T[] {
  return hits.filter((hit) => isReputableUrl(hit.url));
}

export const LITERATURE_QUERY_HINT =
  "CRS OR CBO OR NBER OR OECD OR IMF OR journal OR working paper -site:reddit.com -site:facebook.com -site:twitter.com -site:x.com -site:tiktok.com -site:youtube.com";
