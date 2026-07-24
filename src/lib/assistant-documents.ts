import { parse, stringify } from "yaml";

export type AssistantDocuments = {
  configYaml: string;
  domainYaml: string;
  nluYaml: string;
  storiesYaml: string;
  rulesYaml: string;
};

export function assistantDocuments<T extends AssistantDocuments>(source: T) {
  return {
    configYaml: source.configYaml,
    domainYaml: source.domainYaml,
    nluYaml: source.nluYaml,
    storiesYaml: source.storiesYaml,
    rulesYaml: source.rulesYaml,
    endpointsYaml:
      "endpointsYaml" in source && typeof source.endpointsYaml === "string"
        ? source.endpointsYaml
        : "",
    credentialsYaml:
      "credentialsYaml" in source && typeof source.credentialsYaml === "string"
        ? source.credentialsYaml
        : ""
  };
}

function parseObject(source: string, label: string) {
  const value = parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a YAML object.`);
  }
  return value as Record<string, unknown>;
}

export function validateAssistantDocuments(documents: AssistantDocuments) {
  const config = parseObject(documents.configYaml, "config.yml");
  const domain = parseObject(documents.domainYaml, "domain.yml");
  const nlu = parseObject(documents.nluYaml, "nlu.yml");
  const stories = parseObject(documents.storiesYaml, "stories.yml");
  const rules = parseObject(documents.rulesYaml, "rules.yml");

  if (!Array.isArray(nlu.nlu)) throw new Error("nlu.yml must define an nlu list.");
  if (!Array.isArray(stories.stories)) {
    throw new Error("stories.yml must define a stories list.");
  }
  if (!Array.isArray(rules.rules)) {
    throw new Error("rules.yml must define a rules list.");
  }

  return { config, domain, nlu, stories, rules };
}

export function buildTrainingYaml(documents: AssistantDocuments) {
  const { config, domain, nlu, stories, rules } =
    validateAssistantDocuments(documents);

  return stringify(
    {
      ...config,
      ...domain,
      nlu: nlu.nlu,
      stories: stories.stories,
      rules: rules.rules
    },
    { lineWidth: 0 }
  );
}
