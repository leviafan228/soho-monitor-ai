"""Навчання класифікатора причин збою та експорт моделі для бекенду (Node.js).

Порівнюються:
  * baseline — правило з дипломної версії: downtime > 65 с => знеструмлення, інакше провайдер;
  * логістична регресія (softmax) — обрана для продакшну: інтерпретована, експортується як
    кілька чисел у JSON, інференс у Node.js без Python;
  * градієнтний бустинг — еталон «найкращої досяжної» якості на тих самих ознаках.
Результат: backend/src/ml/model.json + ml/reports/metrics.json + графіки в ml/reports/.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, f1_score, accuracy_score
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler
from generate_dataset import FEATURES, CLASSES

ROOT = Path(__file__).parent
REP = ROOT / 'reports'; REP.mkdir(exist_ok=True)
df = pd.read_csv(ROOT / 'data' / 'incidents_synthetic.csv')
X, y = df[FEATURES].values, df['label'].map({c: i for i, c in enumerate(CLASSES)}).values
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, stratify=y, random_state=7)

scaler = StandardScaler().fit(X_tr)
lr = LogisticRegression(max_iter=2000, C=1.0).fit(scaler.transform(X_tr), y_tr)
gb = HistGradientBoostingClassifier(random_state=7).fit(X_tr, y_tr)

downtime_te = np.exp(X_te[:, 0])
y_base = np.where(downtime_te > 65, 0, 1)            # правило дипломної версії не знає класу DEVICE_FAULT

res = {}
for name, pred in [('baseline_rule_65s', y_base), ('logreg', lr.predict(scaler.transform(X_te))), ('gboost', gb.predict(X_te))]:
    res[name] = {'accuracy': round(accuracy_score(y_te, pred), 4), 'f1_macro': round(f1_score(y_te, pred, average='macro'), 4),
                 'f1_per_class': dict(zip(CLASSES, np.round(f1_score(y_te, pred, average=None, labels=[0, 1, 2]), 4).tolist()))}
cv = cross_val_score(LogisticRegression(max_iter=2000), StandardScaler().fit_transform(X), y, cv=5, scoring='f1_macro')
res['logreg']['cv5_f1_macro_mean'] = round(cv.mean(), 4); res['logreg']['cv5_f1_macro_std'] = round(cv.std(), 4)

# Поріг упевненості: нижче нього система повертає UNKNOWN і просить оператора підтвердити причину
proba = lr.predict_proba(scaler.transform(X_te))
thr_rows = []
for thr in [0.5, 0.6, 0.7, 0.8, 0.9]:
    keep = proba.max(1) >= thr
    thr_rows.append({'threshold': thr, 'coverage': round(keep.mean(), 4),
                     'accuracy_on_covered': round(accuracy_score(y_te[keep], proba[keep].argmax(1)), 4)})
res['confidence_thresholds'] = thr_rows
res['n_train'], res['n_test'] = int(len(X_tr)), int(len(X_te))
print(json.dumps(res, indent=1, ensure_ascii=False))
print(classification_report(y_te, lr.predict(scaler.transform(X_te)), target_names=CLASSES, digits=3))

cm = confusion_matrix(y_te, lr.predict(scaler.transform(X_te)))
fig, ax = plt.subplots(figsize=(5, 4.2))
ax.imshow(cm, cmap='Blues')
ax.set_xticks(range(3), ['Знеструмлення', 'Провайдер', 'Пристрій'], rotation=15); ax.set_yticks(range(3), ['Знеструмлення', 'Провайдер', 'Пристрій'])
for i in range(3):
    for j in range(3):
        ax.text(j, i, cm[i, j], ha='center', va='center', color='white' if cm[i, j] > cm.max() / 2 else 'black')
ax.set_xlabel('Передбачено'); ax.set_ylabel('Фактично'); ax.set_title('Матриця помилок (логістична регресія)')
plt.tight_layout(); plt.savefig(REP / 'confusion_matrix.png', dpi=140)

coef = pd.DataFrame(lr.coef_.T, index=FEATURES, columns=CLASSES)
coef.plot.barh(figsize=(7, 4.5)); plt.title('Ваги ознак (стандартизовані) за класами'); plt.axvline(0, color='k', lw=.6)
plt.tight_layout(); plt.savefig(REP / 'feature_weights.png', dpi=140)

model = {
    'type': 'softmax_logistic_regression', 'version': '1.0.0', 'trained_on': 'incidents_synthetic.csv',
    'features': FEATURES, 'classes': CLASSES,
    'mean': scaler.mean_.round(6).tolist(), 'scale': scaler.scale_.round(6).tolist(),
    'coef': lr.coef_.round(6).tolist(), 'intercept': lr.intercept_.round(6).tolist(),
    'confidence_threshold': 0.6,
    'metrics': {'f1_macro': res['logreg']['f1_macro'], 'accuracy': res['logreg']['accuracy']},
}
(ROOT.parent / 'backend' / 'src' / 'ml' / 'model.json').write_text(json.dumps(model, indent=1), encoding='utf-8')
(REP / 'metrics.json').write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding='utf-8')
# еталонні передбачення для перевірки, що інференс у Node.js дає ті самі ймовірності
ref = {'X': X_te[:20].round(6).tolist(), 'proba': proba[:20].round(6).tolist()}
(ROOT.parent / 'backend' / 'tests' / 'fixtures_model_reference.json').write_text(json.dumps(ref), encoding='utf-8')
print('model.json saved')
