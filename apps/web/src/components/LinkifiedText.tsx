const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;

/** @implements SPEC-FIXED-ROUTE-URLS */
function trimUrlPunctuation(value: string): { url: string; suffix: string } {
  let url = value.replace(/[,\.!?、。]+$/, '');
  while (url.endsWith(')') && url.split(')').length > url.split('(').length) {
    url = url.slice(0, -1);
  }
  return { url, suffix: value.slice(url.length) };
}

/** @implements SPEC-FIXED-ROUTE-URLS — render plain text and link only explicit HTTP(S) URLs. */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_PATTERN).map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={index}>{part}</span>;
        const { url, suffix } = trimUrlPunctuation(part);
        return (
          <span key={index}>
            <a href={url} target="_blank" rel="noreferrer">{url}</a>{suffix}
          </span>
        );
      })}
    </>
  );
}
