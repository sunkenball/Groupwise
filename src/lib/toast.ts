import { createStore } from "./store";

/** One short confirmation at a time ("Copied group ID"). */
export const useToast = createStore<{ text: string | null; id: number }>("toast", { text: null, id: 0 }, undefined, false);

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string) {
  useToast.set(s => ({ text, id: s.id + 1 }));
  clearTimeout(timer);
  timer = setTimeout(() => useToast.set({ text: null }), 2200);
}

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}`);
  } catch {
    toast("Couldn't copy to the clipboard");
  }
}
