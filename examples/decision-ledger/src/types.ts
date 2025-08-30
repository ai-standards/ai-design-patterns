export interface DecisionEntry {
  id: string;
  timestamp: Date;
  title: string;
  decision: string;
  rationale: string;
  alternatives: Alternative[];
  decisionMaker: string;
  stakeholders: string[];
  context?: string;
  outcome?: string;
  tags: string[];
  status: 'active' | 'superseded' | 'reversed';
  supersededBy?: string; // ID of decision that supersedes this one
}

export interface Alternative {
  option: string;
  pros: string[];
  cons: string[];
  whyRejected?: string;
}

export interface DecisionQuery {
  tags?: string[];
  decisionMaker?: string;
  stakeholder?: string;
  status?: DecisionEntry['status'];
  dateRange?: {
    start: Date;
    end: Date;
  };
  searchText?: string;
}
