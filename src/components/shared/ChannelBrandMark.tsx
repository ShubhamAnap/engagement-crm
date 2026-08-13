import { getChannelBrand } from "@/lib/channel-brand";
import { cn } from "@/lib/utils";

const SIZE = { sm: 16, md: 36, lg: 44 } as const;

function Letters({ text, fill }: { text: string; fill: string }) {
  return (
    <text
      x="12"
      y="12.5"
      textAnchor="middle"
      dominantBaseline="central"
      fill={fill}
      fontSize={text.length > 2 ? 8 : 9}
      fontWeight="700"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
    >
      {text}
    </text>
  );
}

function MarkGlyph({ channel, fg }: { channel: string; fg: string }) {
  switch (channel) {
    case "whatsapp":
      return (
        <g fill={fg}>
          <path d="M12 5.2a6.6 6.6 0 0 0-5.7 9.9L5.6 18.4l3.4-.9A6.6 6.6 0 1 0 12 5.2zm3.7 9.1c-.2-.1-1.2-.6-1.4-.7-.2-.1-.3-.1-.5.1l-.5.6c-.1.2-.3.2-.5.1-1-.4-1.9-1.3-2.4-2.3-.1-.2 0-.3.1-.5l.4-.5c.1-.1.1-.3 0-.4-.1-.3-.6-1.4-.8-1.9-.2-.5-.4-.4-.5-.4h-.4c-.2 0-.4.1-.6.3-.5.5-.8 1.2-.8 2 0 1.8 1.6 3.5 1.7 3.6.1.2 2.9 4.5 7.1 5 .9.1 1.6.1 2.2 0 .7-.1 1.2-.6 1.3-1.1.2-.5.2-1 .1-1.1 0-.1-.2-.2-.4-.3z" />
        </g>
      );
    case "email":
      return (
        <g fill="none" stroke={fg} strokeWidth="1.6" strokeLinejoin="round">
          <rect x="5" y="7" width="14" height="10" rx="1.4" />
          <path d="M6 8.2 12 12.4 18 8.2" />
        </g>
      );
    case "facebook":
      return (
        <path
          fill={fg}
          d="M13.6 19V12.9h2.1l.3-2.4h-2.4V9c0-.7.2-1.2 1.2-1.2h1.3V5.7c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.1-3.2 3.2v1.7H8.8v2.4h2.2V19h2.6z"
        />
      );
    case "instagram":
      return (
        <g fill="none" stroke={fg} strokeWidth="1.5">
          <rect x="6" y="6" width="12" height="12" rx="3.2" />
          <circle cx="12" cy="12" r="2.8" />
          <circle cx="15.7" cy="8.3" r="0.7" fill={fg} stroke="none" />
        </g>
      );
    case "website":
      return (
        <g fill="none" stroke={fg} strokeWidth="1.5">
          <circle cx="12" cy="12" r="6.2" />
          <path d="M6 12h12M12 6c1.8 1.8 2.7 3.8 2.7 6S13.8 16.2 12 18C10.2 16.2 9.3 14.2 9.3 12S10.2 7.8 12 6z" />
        </g>
      );
    case "wordpress":
      return <Letters text="W" fill={fg} />;
    case "indiamart":
      return <Letters text="IM" fill={fg} />;
    case "tradeindia":
      return <Letters text="TI" fill={fg} />;
    case "brainmine":
      return <Letters text="BM" fill={fg} />;
    default:
      return <Letters text={channel.slice(0, 2).toUpperCase() || "CH"} fill={fg} />;
  }
}

/** Round partner mark — original SVGs, official brand hex only. */
export function ChannelBrandMark(props: {
  channel: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const channel = String(props.channel || "website").toLowerCase();
  const brand = getChannelBrand(channel);
  const px = SIZE[props.size || "sm"];
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full shadow-sm", props.className)}
      style={{ width: px, height: px, background: brand.accent }}
      title={brand.label}
      aria-label={brand.label}
    >
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden>
        <MarkGlyph channel={channel} fg={brand.fg} />
      </svg>
    </span>
  );
}
