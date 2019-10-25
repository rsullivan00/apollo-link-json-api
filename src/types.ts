export interface ResourceIdentifier {
  id: string;
  type: string;
}

export type RelationshipData = ResourceIdentifier | Array<ResourceIdentifier>;

export interface RelationshipInfo {
  links: object;
  data?: RelationshipData;
}

export interface Relationships {
  [relationshipName: string]: RelationshipInfo;
}

export interface Resource {
  id: string;
  type: string;
  links: object;
  attributes: object;
  relationships?: Relationships;
  __relationships_denormalizing?: boolean;
}

export interface JsonApiBody {
  data: Resource | Array<Resource>;
  included?: Array<Resource> | undefined;
}
