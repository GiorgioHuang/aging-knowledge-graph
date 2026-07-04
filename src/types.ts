// GraceAge Knowledge — V0 model types. Mirror docs/02-knowledge-model.md.

export interface Ontology {
  nodeTypes: string[];
  relationshipTypes: string[];
  definitionalRelationships: string[];
  directions: string[];
  certainties: string[];
  statuses: string[];
  settings: string[];
  studyDesigns: string[];
  domains: string[];
  knownCuriePrefixes: string[];
}

export interface Node {
  id: string;
  type: string;
  name: string;
  description?: string;
  aliases?: string[];
  domains?: string[];
  external_ids?: string[];
}

export interface Claim {
  id: string;
  type: string;
  subject: string;
  object: string;
  population?: string;
  mechanism?: string;
  setting?: string;
  direction?: string;
  effect_value?: number;
  effect_measure?: string;
  effect_note?: string;
  comparator?: string;
  dose?: string;
  certainty?: string;
  rec_strength?: string;
  status: string;
  evidence?: string[];
}

export interface Evidence {
  id: string;
  claim: string;
  source_id: string;
  source_node?: string;
  quote?: string;
  study_design?: string;
  confidence?: number;
  extracted_by?: string;
}

export interface Contradiction {
  id: string;
  subject_claim: string;
  object_claim: string;
}

export interface GraphData {
  nodes: Node[];
  claims: Claim[];
  evidence: Evidence[];
  contradictions: Contradiction[];
}

export interface Graph {
  ontology: Ontology;
  nodes: Map<string, Node>;
  claims: Map<string, Claim>;
  evidence: Map<string, Evidence>;
  contradictions: Contradiction[];
}
