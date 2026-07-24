export const DEFAULT_CONFIG_YAML = `recipe: default.v1
assistant_id: change-me
language: fr

pipeline:
  - name: WhitespaceTokenizer
  - name: RegexFeaturizer
  - name: LexicalSyntacticFeaturizer
  - name: CountVectorsFeaturizer
  - name: CountVectorsFeaturizer
    analyzer: char_wb
    min_ngram: 1
    max_ngram: 4
  - name: DIETClassifier
    epochs: 100
    constrain_similarities: true
  - name: EntitySynonymMapper
  - name: ResponseSelector
    epochs: 100
    constrain_similarities: true
  - name: FallbackClassifier
    threshold: 0.3
    ambiguity_threshold: 0.1

policies:
  - name: MemoizationPolicy
  - name: RulePolicy
  - name: TEDPolicy
    max_history: 5
    epochs: 100
    constrain_similarities: true
`;

export const DEFAULT_DOMAIN_YAML = `version: "3.1"

intents:
  - greet
  - goodbye
  - affirm
  - deny
  - ask_product
  - ask_delivery
  - ask_support

entities:
  - product

slots:
  product:
    type: text
    mappings:
      - type: from_entity
        entity: product

responses:
  utter_greet:
    - text: "Bonjour ! Comment puis-je vous aider ?"
  utter_goodbye:
    - text: "À bientôt !"
  utter_delivery:
    - text: "Je peux vous aider à retrouver les informations de livraison."
  utter_support:
    - text: "Décrivez-moi votre problème et je vais vous orienter."
  utter_default:
    - text: "Je n'ai pas encore compris. Pouvez-vous reformuler ?"

session_config:
  session_expiration_time: 60
  carry_over_slots_to_new_session: true
`;

export const DEFAULT_NLU_YAML = `version: "3.1"

nlu:
  - intent: greet
    examples: |
      - bonjour
      - salut
      - hello
      - bonsoir
  - intent: goodbye
    examples: |
      - au revoir
      - à bientôt
      - bonne journée
  - intent: ask_product
    examples: |
      - je cherche un [télescope](product)
      - avez-vous ce [produit](product) en stock
      - pouvez-vous me conseiller un [oculaire](product)
  - intent: ask_delivery
    examples: |
      - quels sont les délais de livraison
      - où est ma commande
      - combien coûte la livraison
  - intent: ask_support
    examples: |
      - j'ai besoin d'aide
      - mon produit ne fonctionne pas
      - je souhaite contacter le support
`;

export const DEFAULT_STORIES_YAML = `version: "3.1"

stories:
  - story: accueil
    steps:
      - intent: greet
      - action: utter_greet
  - story: fin de conversation
    steps:
      - intent: goodbye
      - action: utter_goodbye
`;

export const DEFAULT_RULES_YAML = `version: "3.1"

rules:
  - rule: répondre aux questions de livraison
    steps:
      - intent: ask_delivery
      - action: utter_delivery
  - rule: orienter vers le support
    steps:
      - intent: ask_support
      - action: utter_support
`;

export const DEFAULT_ENDPOINTS_YAML = `# action_endpoint:
#   url: "http://action-server:5055/webhook"
`;

export const DEFAULT_CREDENTIALS_YAML = `rest:
`;
