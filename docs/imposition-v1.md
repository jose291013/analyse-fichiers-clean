# Imposition PDF — V1

Cette première couche ajoute un moteur de calcul d’imposition au projet `analyse-fichiers-clean`.

## Objectif de cette V1

- Garder la route existante `/analyze-pdf` pour récupérer la TrimBox ou la MediaBox.
- Ajouter une route séparée qui calcule le meilleur schéma d’imposition à partir des dimensions détectées.
- Tester plusieurs formats papier.
- Choisir automatiquement le meilleur format selon la règle : maximum de poses, puis plus petite feuille.
- Retourner un schéma JSON et une prévisualisation SVG affichable dans une interface.

Cette version est volontairement séparée de la génération PDF finale. La prochaine couche utilisera le layout validé pour générer le PDF imposé avec `pdf-lib`.

## Routes ajoutées

### `GET /imposition/paper-sizes`

Retourne les formats papier par défaut.

### `POST /imposition/preview-from-dimensions`

Requête JSON :

```json
{
  "dimensions": {
    "width_mm": 200,
    "height_mm": 280
  },
  "paperSizes": [
    { "id": "A3", "name": "A3", "widthMm": 297, "heightMm": 420 },
    { "id": "SRA3", "name": "SRA3", "widthMm": 320, "heightMm": 450 }
  ],
  "marginMm": 10,
  "gutterMm": 5,
  "allowRotation": true,
  "allowSheetRotation": true,
  "addCropMarks": true,
  "strategy": "max_poses_then_smallest_sheet"
}
```

Réponse principale :

- `selected` : layout sélectionné automatiquement.
- `candidates` : autres formats possibles avec explication.
- `previewSvg` : schéma SVG affichable directement dans l’interface.

## Workflow recommandé

1. Appeler `/analyze-pdf` avec le PDF client.
2. Récupérer `dimensions.width_mm` et `dimensions.height_mm`.
3. Appeler `/imposition/preview-from-dimensions` avec ces dimensions et la liste des formats papier disponibles.
4. Afficher `previewSvg` pour validation.
5. Dans la V2, utiliser le layout validé pour générer le PDF imposé.

## Stratégie par défaut

`max_poses_then_smallest_sheet` :

1. sélectionne le plus grand nombre de poses ;
2. en cas d’égalité, sélectionne la plus petite surface papier ;
3. en cas de nouvelle égalité, sélectionne le moins de gâche.

Exemple : si un produit 200 × 280 mm entre 2 fois sur A3 et 2 fois sur SRA3, A3 est sélectionné car il est plus petit.

## Stratégie prévue ensuite

`lowest_cost_per_copy` :

Si les formats papier contiennent un champ `cost`, le moteur pourra sélectionner le format avec le coût estimé par pose le plus bas.
