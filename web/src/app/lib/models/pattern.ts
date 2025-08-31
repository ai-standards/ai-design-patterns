export interface Pattern {
  id: string;
  title: string;
  section: string;
  description: string;
  hasExample: boolean;
  exampleFiles: string[];
  path: string;
  author: string;
  createdAt: string;
  tags: string[];
}

export interface PatternSection {
  id: string;
  title: string;
  description: string;
  patternCount: number;
}

export interface PatternTag {
  name: string;
  count: number;
}

export interface PatternMetadata {
  totalPatterns: number;
  totalSections: number;
  patternsWithExamples: number;
  totalTags: number;
  lastUpdated: string;
  version: string;
}

export interface PatternIndex {
  patterns: Pattern[];
  sections: PatternSection[];
  tags: PatternTag[];
  metadata: PatternMetadata;
}