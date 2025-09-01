import { Pattern } from "./pattern";

export interface Section {
  id: string;
  title: string;
  description: string;
  patterns: Pattern[];
}
