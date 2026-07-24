"use client";

import { Braces, Plus, Trash2 } from "lucide-react";
import { parse, stringify } from "yaml";

type NluItem = {
  intent?: string;
  examples?: string;
  synonym?: string;
  regex?: string;
  lookup?: string;
  [key: string]: unknown;
};

function readDocument(source: string) {
  try {
    const value = parse(source) as { version?: string; nlu?: NluItem[] };
    return {
      version: value?.version ?? "3.1",
      items: Array.isArray(value?.nlu) ? value.nlu : []
    };
  } catch {
    return { version: "3.1", items: [] };
  }
}

export function NluEditor({
  value,
  onChange,
  editable
}: {
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
}) {
  const document = readDocument(value);
  const intents = document.items.filter((item) => item.intent);
  const otherItems = document.items.filter((item) => !item.intent);

  function commit(nextIntents: NluItem[]) {
    onChange(
      stringify(
        {
          version: document.version,
          nlu: [...nextIntents, ...otherItems]
        },
        { lineWidth: 0 }
      )
    );
  }

  function addIntent() {
    commit([
      ...intents,
      {
        intent: `nouvelle_intention_${intents.length + 1}`,
        examples: "- exemple de message\n- autre formulation\n"
      }
    ]);
  }

  function updateIntent(index: number, patch: NluItem) {
    commit(
      intents.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
  }

  function removeIntent(index: number) {
    commit(intents.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="nlu-builder">
      <div className="editor-intro">
        <div>
          <p className="eyebrow">Compréhension</p>
          <h3>Intentions et exemples NLU</h3>
          <p>
            Chaque ligne représente une formulation utilisateur. Utilisez la
            syntaxe <span className="mono">[valeur](entité)</span> pour annoter
            une entité.
          </p>
        </div>
        {editable ? (
          <button className="button secondary" onClick={addIntent} type="button">
            <Plus />
            Ajouter une intention
          </button>
        ) : null}
      </div>

      <div className="intent-grid">
        {intents.map((intent, index) => (
          <article className="intent-card" key={`${intent.intent}-${index}`}>
            <div className="intent-card-head">
              <span>
                <Braces />
              </span>
              <input
                aria-label="Nom de l’intention"
                className="intent-name"
                onChange={(event) =>
                  updateIntent(index, { intent: event.target.value })
                }
                readOnly={!editable}
                value={String(intent.intent ?? "")}
              />
              {editable ? (
                <button
                  aria-label="Supprimer l’intention"
                  className="icon-button danger-icon"
                  onClick={() => removeIntent(index)}
                  type="button"
                >
                  <Trash2 />
                </button>
              ) : null}
            </div>
            <textarea
              aria-label={`Exemples de ${intent.intent}`}
              className="textarea intent-examples mono"
              onChange={(event) =>
                updateIntent(index, { examples: event.target.value })
              }
              readOnly={!editable}
              spellCheck={false}
              value={String(intent.examples ?? "")}
            />
            <div className="intent-count">
              {
                String(intent.examples ?? "")
                  .split("\n")
                  .filter((line) => line.trim().startsWith("-")).length
              }{" "}
              exemples
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
