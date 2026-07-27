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
  - ask_product_advice
  - ask_compatibility
  - ask_product_comparison
  - ask_availability
  - ask_delivery_policy
  - ask_payment_policy
  - ask_order_account
  - ask_return_policy
  - ask_after_sales
  - ask_technical_help
  - ask_sky_forecast
  - ask_sky_events
  - ask_observation_advice
  - ask_account
  - ask_membership
  - ask_professional

entities:
  - product
  - city
  - country
  - latitude
  - longitude

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
  utter_product_advice:
    - text: "Je vais rechercher les références et connaissances produit pertinentes sans inventer de caractéristique."
  utter_compatibility:
    - text: "Indiquez uniquement la référence ou la dimension encore manquante ; sans cela, la compatibilité ne peut pas être confirmée."
  utter_product_comparison:
    - text: "Indiquez uniquement les références ou familles qui ne sont pas déjà nommées ; la comparaison s’appuiera sur leurs caractéristiques publiées."
  utter_availability:
    - text: "Indiquez le modèle ou le SKU du produit ; aucun stock ni délai ne peut être affirmé sans résultat catalogue actuel."
  utter_delivery_policy:
    - text: "Je peux expliquer les informations publiques de livraison, mais pas promettre une date ou un tarif absent des données disponibles."
  utter_payment_policy:
    - text: "Je peux expliquer les moyens de paiement et promotions affichés publiquement par la boutique, sans consulter ni modifier un paiement personnel. L’existence d’un code promotionnel actif ou son éligibilité doit être vérifiée dans les offres actuellement publiées ou dans le panier."
  utter_order_account:
    - text: "Les commandes et paiements personnels doivent être consultés depuis l’espace client sécurisé."
  utter_return_policy:
    - text: "Pour un achat de consommateur dans l’Union européenne, le délai légal de rétractation est en principe de 14 jours après réception, sous réserve des exceptions. L’emballage d’origine est recommandé, mais les conditions exactes, les frais et l’adresse de retour doivent être vérifiés dans la politique de retour de la boutique. En France, la garantie légale de conformité d’un bien neuf est en principe de deux ans. Un dossier individuel doit être ouvert depuis l’espace client ou le support sécurisé."
  utter_after_sales:
    - text: "Je peux proposer un diagnostic sans danger. Un dossier SAV et ses pièces jointes doivent passer par le support sécurisé."
  utter_technical_help:
    - text: "Décrivez le modèle exact, le symptôme et le test déjà effectué, sans transmettre de donnée personnelle."
  utter_sky_forecast:
    - text: "Une localisation approximative et une date ou période sont nécessaires pour une prévision d’observation. Utilisez celles déjà présentes dans le message et demandez en une seule réponse uniquement toutes les informations manquantes, sans redemander celles qui sont déjà fournies."
  utter_sky_events:
    - text: "Une localisation approximative et une date ou période sont nécessaires pour calculer les objets ou événements visibles. Utilisez celles déjà présentes dans le message et demandez en une seule réponse uniquement toutes les informations manquantes, sans redemander celles qui sont déjà fournies."
  utter_observation_advice:
    - text: "Je peux proposer des conseils d’observation généraux et sûrs à partir de votre lieu et de votre équipement."
  utter_account:
    - text: "Les données et actions de compte sont accessibles uniquement depuis l’espace client sécurisé."
  utter_membership:
    - text: "Je peux expliquer uniquement les avantages publiquement documentés ; le statut personnel ou l’éligibilité d’une commande nécessitent l’espace client sécurisé."
  utter_professional:
    - text: "Les demandes de devis, club, école, partenariat ou affiliation doivent être transmises à l’équipe commerciale par le canal officiel."
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
  - intent: ask_product_advice
    examples: |
      - Quel télescope me conseillez-vous pour débuter ?
      - Quel télescope convient pour observer les planètes ?
      - Je veux faire de l’astrophotographie avec un budget de 1 000 €.
      - Ce télescope est-il adapté à un enfant ?
      - Quel modèle est facile à transporter ?
      - Quel télescope choisir depuis une ville très lumineuse ?
      - Est-ce que je pourrai voir les galaxies avec ce modèle ?
  - intent: ask_compatibility
    examples: |
      - Cette caméra est-elle compatible avec mon télescope ?
      - Cet oculaire fonctionne-t-il avec un porte-oculaire 31,75 mm ?
      - Cette monture peut-elle supporter mon tube ?
      - Ce correcteur de coma est-il adapté à mon Newton ?
      - Est-ce que cet adaptateur fonctionne avec mon appareil Canon ?
      - Cette lunette est-elle compatible avec l’ASIAIR ?
      - Puis-je installer ce Dobson sur un trépied ?
      - Quel filtre solaire correspond au diamètre de mon télescope ?
  - intent: ask_product_comparison
    examples: |
      - Comparez ces deux télescopes.
      - Quelle différence entre ces deux caméras ?
      - Lequel est le meilleur pour le ciel profond ?
      - Est-ce que le modèle plus cher vaut réellement la différence ?
      - Quelle monture est la plus simple entre une EQ5 et une HEQ5 ?
      - Quelle différence entre un Dobson 130/650 et un 150/750 ?
  - intent: ask_availability
    examples: |
      - Ce produit est-il en stock ?
      - Quand sera-t-il de nouveau disponible ?
      - Pouvez-vous me prévenir lors du réapprovisionnement ?
  - intent: ask_delivery_policy
    examples: |
      - Sera-t-il livré avant mon anniversaire ?
      - Livrez-vous en Belgique, en Suisse ou en Suède ?
      - Combien coûte la livraison ?
      - Quel transporteur utilisez-vous ?
      - La TVA est-elle incluse ?
      - Comment fonctionne la TVA pour une livraison en Suisse ?
  - intent: ask_payment_policy
    examples: |
      - Avez-vous un code promotionnel ?
      - Puis-je payer en plusieurs fois ?
      - Pourquoi mon code promotionnel ne fonctionne pas ?
      - Je n’arrive pas à finaliser le paiement.
      - Le paiement a-t-il bien été accepté ?
  - intent: ask_order_account
    examples: |
      - Affiche mes commandes récentes.
      - Vérifie si mon paiement a été reçu.
      - Retrouve ma commande avec mon adresse email.
      - Envoie-moi un nouveau lien de paiement.
      - Puis-je modifier mon adresse avant de payer ?
      - Puis-je ajouter un produit à ma commande ?
      - Où est ma commande ?
      - Ma commande a-t-elle été expédiée ?
      - Donnez-moi mon numéro de suivi.
      - Pourquoi le suivi ne bouge plus ?
      - Quelle est la date estimée de livraison ?
      - Mon colis semble perdu, que dois-je faire ?
      - Le transporteur indique livré, mais je n’ai rien reçu.
      - Je souhaite changer l’adresse de livraison.
      - Je veux remplacer un produit par un autre.
      - Ajoutez cet accessoire à ma commande.
      - Je souhaite annuler ma commande.
      - Puis-je changer le mode de livraison ?
      - Télécharge ma facture.
      - Modifiez le nom ou l’adresse sur la facture.
      - Renvoyez-moi la confirmation de commande.
      - Pouvez-vous fournir un justificatif de paiement ?
  - intent: ask_return_policy
    examples: |
      - Je souhaite retourner un produit.
      - Quel est le délai de rétractation ?
      - Comment obtenir une étiquette de retour ?
      - Où dois-je envoyer le produit ?
      - Le produit doit-il être dans son emballage d’origine ?
      - Combien coûte le retour ?
      - Quelle est la durée de garantie ?
  - intent: ask_after_sales
    examples: |
      - Mon produit est arrivé cassé.
      - Il manque une pièce dans le colis.
      - Le colis était endommagé à la réception.
      - L’accessoire reçu n’est pas le bon.
      - Pouvez-vous m’envoyer uniquement la pièce manquante ?
      - Mon télescope ne fonctionne plus.
      - Comment ouvrir une demande de SAV ?
      - Dois-je retourner tout le produit ou seulement la pièce ?
      - Où trouver le numéro de série ?
      - Pouvez-vous diagnostiquer la panne avant un retour ?
      - Où en est mon remboursement ?
      - Quand vais-je recevoir l’argent ?
      - Puis-je être remboursé sur un autre moyen de paiement ?
      - Je préfère un avoir plutôt qu’un remboursement.
  - intent: ask_technical_help
    examples: |
      - Comment monter ce télescope ?
      - Comment équilibrer une monture équatoriale ?
      - Comment installer le chercheur ?
      - Comment faire la mise en station ?
      - Comment connecter ma monture à mon téléphone ?
      - Comment installer une caméra dans le porte-oculaire ?
      - Pourquoi je ne vois rien dans l’oculaire ?
      - Pourquoi l’image est-elle floue ?
      - Pourquoi les étoiles ressemblent-elles à des traits ?
      - Comment faire la mise au point ?
      - Quel oculaire utiliser pour observer Jupiter ?
      - Quel grossissement utiliser avec mon télescope ?
      - Ma monture ne démarre pas.
      - Un moteur ne tourne pas.
      - L’application ne détecte pas la caméra.
      - L’ASIAIR ne reconnaît pas ma monture.
      - Je n’arrive pas à faire l’alignement polaire.
      - Le suivi est mauvais.
      - Mes images présentent du coma.
      - J’ai de la buée sur la lentille.
  - intent: ask_sky_forecast
    examples: |
      - Est-ce que la météo sera bonne pour observer ?
      - La météo permet-elle d’observer ce soir à [Toulouse](city) ?
      - Quel est le meilleur créneau d’observation à [Paris](city) ?
  - intent: ask_sky_events
    examples: |
      - Que puis-je observer ce soir ?
      - Quels objets sont visibles depuis [Toulouse](city) ?
      - Quelle est la meilleure heure pour voir Saturne ?
      - Comment préparer l’éclipse du 12 août 2026 ?
  - intent: ask_observation_advice
    examples: |
      - Que puis-je voir avec un télescope de 130 mm ?
      - Quels objets sont faciles pour un débutant ?
      - Quel filtre utiliser pour cette nébuleuse ?
      - Puis-je observer le Soleil avec cet équipement ?
  - intent: ask_account
    examples: |
      - Modifie mon adresse.
      - Change mon adresse email.
      - Réinitialise mon mot de passe.
      - Quels produits ai-je déjà achetés ?
      - Quel matériel ai-je enregistré ?
      - Ajoute ce télescope à mon équipement.
      - Supprime mon compte.
      - Quelles données avez-vous sur moi ?
      - Désabonne-moi de la newsletter.
  - intent: ask_membership
    examples: |
      - Est-ce que la réduction Astronomy+ s’applique ?
      - Suis-je membre Astronomy+ ?
      - Quand mon abonnement expire-t-il ?
      - Quelle réduction ai-je obtenue ?
      - Comment annuler mon abonnement ?
      - Quels sont mes avantages ?
      - Combien de points ou de crédits ai-je ?
      - Ma réduction peut-elle être appliquée à cette commande ?
  - intent: ask_professional
    examples: |
      - Proposez-vous un tarif pour les clubs d’astronomie ?
      - Puis-je obtenir un devis ?
      - Pouvez-vous créer une facture au nom de mon entreprise ?
      - J’ai besoin d’une facture sans TVA.
      - Je représente un club et je souhaite un devis.
      - Comment fonctionne le remboursement de la cotisation du club ?
      - Proposez-vous des commandes groupées ?
      - Nous sommes une école et souhaitons acheter plusieurs télescopes.
      - Je souhaite devenir revendeur.
      - Je veux proposer un partenariat ou tester un produit.
      - Avez-vous un programme d’affiliation ?
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
  - rule: conseil produit
    steps:
      - intent: ask_product_advice
      - action: utter_product_advice
  - rule: compatibilité
    steps:
      - intent: ask_compatibility
      - action: utter_compatibility
  - rule: comparaison
    steps:
      - intent: ask_product_comparison
      - action: utter_product_comparison
  - rule: disponibilité
    steps:
      - intent: ask_availability
      - action: utter_availability
  - rule: livraison publique
    steps:
      - intent: ask_delivery_policy
      - action: utter_delivery_policy
  - rule: paiement public
    steps:
      - intent: ask_payment_policy
      - action: utter_payment_policy
  - rule: commande sécurisée
    steps:
      - intent: ask_order_account
      - action: utter_order_account
  - rule: retours
    steps:
      - intent: ask_return_policy
      - action: utter_return_policy
  - rule: sav
    steps:
      - intent: ask_after_sales
      - action: utter_after_sales
  - rule: assistance technique
    steps:
      - intent: ask_technical_help
      - action: utter_technical_help
  - rule: météo du ciel
    steps:
      - intent: ask_sky_forecast
      - action: utter_sky_forecast
  - rule: événements du ciel
    steps:
      - intent: ask_sky_events
      - action: utter_sky_events
  - rule: conseils d’observation
    steps:
      - intent: ask_observation_advice
      - action: utter_observation_advice
  - rule: compte sécurisé
    steps:
      - intent: ask_account
      - action: utter_account
  - rule: astronomy plus
    steps:
      - intent: ask_membership
      - action: utter_membership
  - rule: professionnels
    steps:
      - intent: ask_professional
      - action: utter_professional
`;

export const DEFAULT_ENDPOINTS_YAML = `# action_endpoint:
#   url: "http://action-server:5055/webhook"
`;

export const DEFAULT_CREDENTIALS_YAML = `rest:
`;
