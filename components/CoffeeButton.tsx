import { Icon } from "./icons";

const COFFEE_URL = "https://buymeacoffee.com/hasnain.dev";

/** Floating "Buy me a coffee" link. Icon-only on phones, expands to a pill on wider screens. */
export function CoffeeButton() {
  return (
    <a
      href={COFFEE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Buy me a coffee"
      title="Buy me a coffee"
      className="coffee-fab anim-pop fixed z-30 flex h-14 items-center gap-2 rounded-full px-4 text-[15px] font-semibold shadow-lg transition-transform hover:-translate-y-0.5 active:scale-95"
    >
      <Icon name="coffee" size={22} />
      <span className="hidden sm:inline">Buy me a coffee</span>
    </a>
  );
}
