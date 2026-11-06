export type ConceptScreen =
  | "overview"
  | "projects"
  | "agents"
  | "caches"
  | "history"
  | "settings"
  | "cleanup-modal"
  | "permanent-modal";

export type ConceptVariant = "A" | "B";

export interface MockItem {
  id: string;
  name: string;
  path: string;
  ecosystem: string;
  sizeBytes: number;
  safety: "safe" | "regenerate" | "review";
  selected: boolean;
  lastModified: string;
}

export const MOCK_PROJECT_ITEMS: MockItem[] = [
  {
    id: "item-1",
    name: "node_modules",
    path: "D:\\dev\\projects\\web-platform\\node_modules",
    ecosystem: "Node.js",
    sizeBytes: 1420000000,
    safety: "safe",
    selected: true,
    lastModified: "2 gün önce",
  },
  {
    id: "item-2",
    name: "target",
    path: "D:\\dev\\projects\\rust-engine\\target",
    ecosystem: "Rust",
    sizeBytes: 3840000000,
    safety: "safe",
    selected: true,
    lastModified: "Dün",
  },
  {
    id: "item-3",
    name: ".venv",
    path: "D:\\dev\\ai-models\\nlp-pipeline\\.venv",
    ecosystem: "Python",
    sizeBytes: 2150000000,
    safety: "regenerate",
    selected: true,
    lastModified: "4 saat önce",
  },
  {
    id: "item-4",
    name: "bin / obj",
    path: "D:\\dev\\enterprise-services\\backend\\obj",
    ecosystem: ".NET",
    sizeBytes: 890000000,
    safety: "safe",
    selected: false,
    lastModified: "1 hafta önce",
  },
  {
    id: "item-5",
    name: ".gradle",
    path: "D:\\dev\\mobile\\android-app\\.gradle",
    ecosystem: "Java/Kotlin",
    sizeBytes: 1670000000,
    safety: "safe",
    selected: true,
    lastModified: "3 gün önce",
  },
  {
    id: "item-6",
    name: ".dart_tool",
    path: "D:\\dev\\cross-platform\\flutter-app\\.dart_tool",
    ecosystem: "Dart/Flutter",
    sizeBytes: 640000000,
    safety: "safe",
    selected: false,
    lastModified: "5 gün önce",
  },
];

