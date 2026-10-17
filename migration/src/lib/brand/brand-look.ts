/**
 * One client's look as Brand Studio's draft has it: what the participant screens read from today's live
 * experience, here handed in so the real screens can be drawn from a draft (BrandPreviewStage.svelte).
 */
export type Look = {
  scene: 'welcome' | 'activities' | 'question' | 'correct' | 'finale';
  clientName: string;
  eventTitle: string;
  eventSubtitle: string;
  welcomeLine: string;
  logoText: string;
  heroUrl: string | null;
  logoUrl: string | null;
  plate: 'light' | 'dark';
  backgroundUrl: string | null;
  backgroundFocus: { x: number; y: number } | null;
};
