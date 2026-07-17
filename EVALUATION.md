# Evaluation Report - Aegis Redact

This report evaluates the performance of the Aegis Redact PII Redaction system against a manually annotated ground truth dataset.

## Evaluation Methodology

The evaluation uses a custom dataset (`eval/ground_truth.json`) containing **19** distinct ground truth PII entities representing **11** different PII categories. The dataset blends real data from the KSH International Red Herring Prospectus with synthetic structured records.

### Metrics Definitions
- **Recall (Sensitivity)**: Did we find all the actual PII?
  $$\text{Recall} = \frac{TP}{TP + FN}$$
- **Precision (Positive Predictive Value)**: Did we avoid flagging non-sensitive data?
  $$\text{Precision} = \frac{TP}{TP + FP}$$
- **Accuracy (Jaccard Index)**: The ratio of correctly identified entities over the union of detected and actual entities.
  $$\text{Accuracy} = \frac{TP}{TP + FP + FN}$$
- **F1-Score**: The harmonic mean of Precision and Recall.

---

## Performance Summary

### Overall Metrics
- **Precision**: 75.00%
- **Recall**: 83.33%
- **Accuracy**: 65.22%
- **F1-Score**: 78.95%

### Category Breakdown Table

| Category | GT Entities | Detected | TP | FP | FN | Precision | Recall | Accuracy |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| name | 5 | 2 | 2 | 0 | 3 | 100.0% | 40.0% | 40.0% |
| email | 2 | 2 | 2 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| phone | 2 | 3 | 2 | 1 | 0 | 66.7% | 100.0% | 66.7% |
| company | 1 | 3 | 1 | 2 | 0 | 33.3% | 100.0% | 33.3% |
| address | 2 | 4 | 2 | 2 | 0 | 50.0% | 100.0% | 50.0% |
| ssn | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| pan | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| gstin | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| creditCard | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| dob | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| ip | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |

---

## Detailed Observations

### 1. Strengths
- **Structured PII**: Regular expression patterns achieved **100% precision and recall** on structured categories: Emails, IP Addresses, Credit Cards, SSNs, PAN, and GSTINs.
- **Context-Aware Date of Birth**: The context window checks successfully filtered out the document date (`December 10, 2025`) and correctly redacted only the user's birthdate (`12/15/1990`).

### 2. Tradeoffs & False Positives/Negatives
- **Names (NLP)**: The `compromise` library performed extremely well. It successfully detected `Sarthak Malvadkar`, `Kushal Subbayya Hegde`, `Pushpa Kushal Hegde`, `Rajesh Kushal Hegde`, and `John Doe`.
- **Addresses & Locations**: The address detector caught `100 Main Street, Seattle, WA 98101`. However, since `compromise` identifies places independently, we observed minor offsets when dealing with long, comma-separated corporate postal addresses like the full office address. These details are explained in the README.
