"""Перенавчання класифікатора на реальних подіях з MongoDB (weak supervision + підтвердження оператора).

Мітка події:
  * confirmedCause — якщо причину підтвердив оператор;
  * cause з method == 'rule' — якщо роутер мав UPnP і вердикт дало детерміноване правило.
Модель оновлюється, лише якщо F1-macro на відкладеній вибірці не гірший, ніж у поточної.
Використання: python retrain_from_events.py --mongo mongodb://127.0.0.1:27017/soho_monitor
"""
import argparse, json
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from generate_dataset import FEATURES, CLASSES

ROOT = Path(__file__).parent
MODEL = ROOT.parent / 'backend' / 'src' / 'ml' / 'model.json'


def load_events(uri):
    from pymongo import MongoClient   # pip install pymongo
    db = MongoClient(uri).get_default_database()
    rows = []
    for e in db.eventlogs.find({'features': {'$ne': None}}):
        label = e.get('confirmedCause') or (e.get('cause') if e.get('method') == 'rule' else None)
        if label in CLASSES and all(k in e['features'] for k in FEATURES):
            rows.append({**{k: e['features'][k] for k in FEATURES}, 'label': label})
    return pd.DataFrame(rows)


def proba(model, X):
    z = (X - np.array(model['mean'])) / np.array(model['scale'])
    logits = z @ np.array(model['coef']).T + np.array(model['intercept'])
    e = np.exp(logits - logits.max(1, keepdims=True))
    return e / e.sum(1, keepdims=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--mongo', required=True); args = ap.parse_args()
    real = load_events(args.mongo)
    synth = pd.read_csv(ROOT / 'data' / 'incidents_synthetic.csv')
    print(f'Реальних розмічених подій: {len(real)}')
    data = pd.concat([synth, real, real, real], ignore_index=True)   # реальні події з вагою ×3
    X, y = data[FEATURES].values, data['label'].map({c: i for i, c in enumerate(CLASSES)}).values
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, stratify=y, random_state=7)
    sc = StandardScaler().fit(X_tr)
    lr = LogisticRegression(max_iter=2000).fit(sc.transform(X_tr), y_tr)
    f1_new = f1_score(y_te, lr.predict(sc.transform(X_te)), average='macro')
    old = json.loads(MODEL.read_text(encoding='utf-8'))
    f1_old = f1_score(y_te, proba(old, X_te).argmax(1), average='macro')
    print(f'F1-macro: поточна модель {f1_old:.4f}, нова {f1_new:.4f}')
    if f1_new + 1e-4 < f1_old:
        print('Нова модель гірша — model.json не змінено'); return
    major, minor, patch = map(int, old['version'].split('.'))
    old.update({'version': f'{major}.{minor + 1}.0', 'trained_on': f'synthetic + {len(real)} real events',
                'mean': sc.mean_.round(6).tolist(), 'scale': sc.scale_.round(6).tolist(),
                'coef': lr.coef_.round(6).tolist(), 'intercept': lr.intercept_.round(6).tolist(),
                'metrics': {'f1_macro': round(f1_new, 4)}})
    MODEL.write_text(json.dumps(old, indent=1), encoding='utf-8')
    print('model.json оновлено до версії', old['version'])


if __name__ == '__main__':
    main()
