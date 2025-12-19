import { create } from 'zustand';

type PromptState = {
  open: boolean;
  title: string;
  defaultValue?: string;
  onSubmit?: (value: string) => void;
};

const initialPrompt: PromptState = { open: false, title: '' };

type PromptStore = {
  prompt: PromptState;
  openPrompt: (title: string, defaultValue: string, onSubmit: (value: string) => void) => void;
  closePrompt: () => void;
};

export const usePromptStore = create<PromptStore>((set) => ({
  prompt: initialPrompt,
  openPrompt: (title, defaultValue, onSubmit) =>
    set({ prompt: { open: true, title, defaultValue, onSubmit } }),
  closePrompt: () => set({ prompt: initialPrompt }),
}));
