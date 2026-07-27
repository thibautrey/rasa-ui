export type RuntimePolicyDecision = {
  intent: "auth_required" | "human_contact_required" | "secure_support_required";
  reply: string;
};

const AUTH_REQUIRED_REPLY =
  "Cette demande concerne des données personnelles ou une action sur un compte, une commande, un paiement ou un abonnement. Je ne peux ni consulter ni modifier ces éléments dans ce chat. Connectez-vous à l’espace client sécurisé ou contactez le support depuis cet espace, sans partager ici d’adresse, d’email, de référence de commande ni de donnée de paiement.";

const SECURE_SUPPORT_REQUIRED_REPLY =
  "Cette demande nécessite l’ouverture ou la consultation d’un dossier sécurisé. Utilisez l’espace client ou le formulaire de support pour transmettre la référence de commande, les photos ou les documents utiles. Ne publiez pas ces informations dans ce chat.";

const HUMAN_CONTACT_REQUIRED_REPLY =
  "Cette demande nécessite une prise en charge par l’équipe commerciale ou le support. Utilisez le canal de contact officiel du site ; aucun devis, abonnement, notification ou modification n’a été créé depuis ce chat.";

const authRequiredPatterns = [
  /\b(?:affiche|montre|liste|retrouve|verifie|consulte)\b.{0,50}\b(?:mes?|ma|mon)\s+(?:commandes?|paiements?|factures?|achats?|abonnements?|credits?|points?)\b/u,
  /\b(?:ou est|suivre|suivi|expedie|livre|transporteur|date estimee)\b.{0,50}\b(?:ma|mon)\s+(?:commande|colis|livraison)\b/u,
  /\b(?:ma|mon)\s+(?:commande|colis|livraison|paiement|remboursement|facture)\b.{0,80}\b(?:ou|quand|recu|accepte|expedi|livr|perdu|bloque|statut|suivi|numero)\w*\b/u,
  /\b(?:modifie|modifier|change|changer|remplace|remplacer|ajoute|ajouter|annule|annuler)\b.{0,80}\b(?:ma|mon|mes)\s+(?:adresse|email|commande|livraison|produit|compte|abonnement)\b/u,
  /\b(?:modifi\w*|chang\w*|remplac\w*|ajout\w*)\b.{0,80}\b(?:adresse de livraison|mode de livraison|produit par un autre|accessoire a (?:ma|la) commande)\b/u,
  /\b(?:telecharg\w*|renvo\w*|corrig\w*|modifi\w*|fourni\w*)\b.{0,80}\b(?:ma|mon|la|une)?\s*(?:facture|confirmation de commande|justificatif de paiement)\b/u,
  /\b(?:donne|donnez|quel est)\b.{0,50}\b(?:mon )?numero de suivi\b/u,
  /\bdate estimee de livraison\b/u,
  /\b(?:nouveau lien de paiement|paiement a(?: ete|-t-il)|finaliser le paiement|code promotionnel ne fonctionne)\b/u,
  /\b(?:suis-je membre|mon abonnement|mes avantages|mes points|mes credits|ma reduction)\b/u,
  /\b(?:quelle reduction ai-je obtenue|combien de points|combien de credits)\b/u,
  /\b(?:produits? (?:ai-je|que j.ai) deja achetes?|materiel (?:ai-je|que j.ai) enregistre)\b/u,
  /\b(?:reinitialise|reinitialiser|change|changer)\b.{0,40}\b(?:mon )?mot de passe\b/u,
  /\b(?:supprime|supprimer)\b.{0,40}\b(?:mon )?compte\b/u,
  /\b(?:quelles donnees|donnees avez-vous)\b.{0,40}\b(?:moi|mon sujet)\b/u,
  /\b(?:desabonne|desabonner)\b.{0,40}\bnewsletter\b/u,
  /\b(?:ajoute|ajouter)\b.{0,50}\b(?:mon equipement|a mon equipement)\b/u,
  /\b(?:appliquer|appliquee)\b.{0,50}\b(?:ma reduction|cette commande)\b/u
] as const;

const secureSupportPatterns = [
  /\b(?:arrive|recu|colis)\b.{0,60}\b(?:casse|endommage|incomplet|mauvais|manque|perdu)\b/u,
  /\b(?:il manque|piece manquante|accessoire recu n.est pas le bon)\b/u,
  /\b(?:ouvrir|creer|declarer)\b.{0,50}\b(?:demande de sav|dossier sav|retour|produit endommage)\b/u,
  /\b(?:etiquette de retour|envoyer uniquement la piece|retourner tout le produit)\b/u,
  /\b(?:transporteur indique livre|suivi ne bouge|colis semble perdu)\b/u,
  /\b(?:je souhaite|je veux)\b.{0,30}\bretourner\b.{0,30}\bproduit\b/u,
  /\b(?:ou en est|quand vais-je recevoir)\b.{0,40}\bremboursement\b/u,
  /\b(?:quand vais-je recevoir l.argent|prefere un avoir)\b/u,
  /\brembourse\b.{0,40}\b(?:autre moyen|avoir)\b/u
] as const;

const humanContactPatterns = [
  /\b(?:prevenir|prevenez|notifier|notification)\b.{0,50}\b(?:reapprovisionnement|retour en stock|disponible)\b/u,
  /\b(?:obtenir|creer|fournir|souhaite)\b.{0,40}\bdevis\b/u,
  /\bfacture\b.{0,50}\b(?:entreprise|societe|sans tva)\b/u,
  /\b(?:tarif pour les clubs?|club|ecole|revendeur|partenariat|affiliation|commandes? groupees?|tester un produit)\b/u,
  /\bremboursement\b.{0,50}\bcotisation\b.{0,30}\bclub\b/u
] as const;

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[’']/g, ".");
}

function matches(
  value: string,
  patterns: readonly RegExp[]
) {
  return patterns.some((pattern) => pattern.test(value));
}

export function runtimePolicyDecision(
  text: string
): RuntimePolicyDecision | null {
  const value = normalized(text);
  if (matches(value, authRequiredPatterns)) {
    return {
      intent: "auth_required",
      reply: AUTH_REQUIRED_REPLY
    };
  }
  if (matches(value, secureSupportPatterns)) {
    return {
      intent: "secure_support_required",
      reply: SECURE_SUPPORT_REQUIRED_REPLY
    };
  }
  if (matches(value, humanContactPatterns)) {
    return {
      intent: "human_contact_required",
      reply: HUMAN_CONTACT_REQUIRED_REPLY
    };
  }
  return null;
}
