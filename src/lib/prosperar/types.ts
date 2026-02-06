export type EditionStatus = "DRAFT" | "READY" | "RUNNING" | "FINISHED";
export type RoundStatus = "READY" | "RUNNING" | "CLOSED";

export type Edition = {
  id: string;
  name: string;
  status: EditionStatus;
  createdAt?: any;
  createdBy?: string | null;

  /** Quantidade de rodadas desta edição (ex.: 3, 4, 5...). */
  roundsCount?: number;

  /** Link da live/sorteio (YouTube). Exibido em /resultado e no admin. */
  youtubeUrl?: string | null;
  /** Data/hora prevista do sorteio (opcional). */
  scheduledAt?: any;

  // controle de lotes/numeração (opcional)
  nextCardNumber?: number; // próximo número público (sequencial)
  nextBatch?: number; // próximo lote
  cardNumberMinDigits?: number; // mínimo de dígitos na impressão (ex.: 4 => 0001)
};

export type Round = {
  id: string; // "1".."N"
  index: number; // 1..N
  prizeCents: number;
  status: RoundStatus;
  drawnNumbers: number[];
  startedAt?: any;
  closedAt?: any;
  winners?: { cardId: string; printedNumber: string; publicNumberInt: number }[];
  winnersCount?: number;
  prizePerWinnerCents?: number;
};

export type CardStatus = "GENERATED" | "AVAILABLE" | "VALIDATED";

export type Card = {
  id: string;
  /** Número público normalizado (sem zeros à esquerda). Use para busca/ordenação. */
  publicNumberInt: number;
  /** Número impresso (com zeros à esquerda quando aplicável). Use para exibição. */
  printedNumber: string;

  numbers: number[]; // exactly 20 (1..50)
  status: CardStatus;
  batch: number;
  createdAt?: any;
  validatedAt?: any;
  validatedBy?: string | null;

  // vínculo com venda/cadastro
  saleId?: string | null;
};
