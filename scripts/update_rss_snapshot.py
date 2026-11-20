import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


MAX_FEED_BYTES = 5 * 1024 * 1024
MAX_STORIES_PER_FEED = 4
FETCH_TIMEOUT_SECONDS = 18
USER_AGENT = "streamTVapp RSS updater (GitHub Actions)"


class SummaryTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def local_name(tag):
    return tag.rsplit("}", 1)[-1].split(":")[-1].lower()


def child_text(element, names):
    for child in element:
        if local_name(child.tag) in names:
            text = "".join(child.itertext()).strip()
            if text:
                return text
    return ""


def story_link(item, feed_url):
    for child in item:
        if local_name(child.tag) != "link":
            continue
        href = child.attrib.get("href")
        if href and child.attrib.get("rel", "alternate").lower() == "alternate":
            return urljoin(feed_url, href)
        if child.text and child.text.strip():
            return urljoin(feed_url, child.text.strip())

    guid = child_text(item, {"guid", "id"})
    if guid and urlsplit(guid).scheme.lower() in {"http", "https"}:
        return guid
    return ""


def parse_published(value):
    if not value:
        return 0
    try:
        date = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        try:
            date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return 0
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return int(date.timestamp() * 1000)


def clean_summary(value):
    if not value:
        return ""
    parser = SummaryTextParser()
    parser.feed(value)
    text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    return text if len(text) <= 320 else text[:317].rstrip() + "…"


def parse_feed(content, feed):
    root = ET.fromstring(content)
    items = [element for element in root.iter()
             if local_name(element.tag) in {"item", "entry"}]
    stories = []
    seen_links = set()
    for item in items:
        title = child_text(item, {"title"})
        link = story_link(item, feed["url"])
        parts = urlsplit(link)
        if not title or parts.scheme.lower() not in {"http", "https"} or not parts.netloc:
            continue
        if link in seen_links:
            continue
        seen_links.add(link)

        published_text = child_text(
            item, {"pubdate", "published", "updated", "date", "issued", "created"}
        )
        summary_text = child_text(item, {"description", "summary", "content", "encoded"})
        stories.append({
            "title": title,
            "link": link,
            "summary": clean_summary(summary_text),
            "published": parse_published(published_text),
        })

    stories.sort(key=lambda story: story["published"], reverse=True)
    return stories[:MAX_STORIES_PER_FEED]


def fetch_feed(feed):
    result = {
        "url": feed["url"],
        "name": feed["name"],
        "category": feed["category"],
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "stories": [],
        "error": None,
    }
    parts = urlsplit(feed["url"])
    if parts.scheme.lower() not in {"http", "https"} or not parts.netloc:
        result["error"] = "Feed URL must use HTTP or HTTPS."
        return result

    request = Request(feed["url"], headers={
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5",
        "Cache-Control": "no-cache",
        "User-Agent": USER_AGENT,
    })
    try:
        with urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            content = response.read(MAX_FEED_BYTES + 1)
        if len(content) > MAX_FEED_BYTES:
            raise ValueError(f"Feed exceeds the {MAX_FEED_BYTES // (1024 * 1024)} MB size limit.")
        result["stories"] = parse_feed(content, feed)
    except (HTTPError, URLError, TimeoutError, ValueError, ET.ParseError) as error:
        result["error"] = str(error) or error.__class__.__name__
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    feeds = json.load(sys.stdin)
    if not isinstance(feeds, list) or not feeds:
        raise SystemExit("No RSS feed configuration was provided.")

    with ThreadPoolExecutor(max_workers=min(8, len(feeds))) as executor:
        results = list(executor.map(fetch_feed, feeds))

    successful_count = sum(result["error"] is None for result in results)
    for result in results:
        if result["error"]:
            print(f'Unable to fetch {result["name"]}: {result["error"]}', file=sys.stderr)
        else:
            print(f'Fetched {len(result["stories"])} stories from {result["name"]}.')

    if successful_count == 0:
        raise SystemExit("No feeds could be fetched; keeping the previously published site.")

    snapshot = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "feeds": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary_path.replace(args.output)


if __name__ == "__main__":
    main()
