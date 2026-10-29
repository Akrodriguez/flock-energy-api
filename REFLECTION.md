# Assignment Reflection



## 1. Main Challenge



The most challenging part was integrating reliably with the upstream Urja Meter Ops portal. The adapter needed to handle session-based authentication, reuse session cookies, recover from authentication failures, and translate upstream errors into consistent API responses.



I addressed this by separating portal communication into a dedicated client service and writing automated tests for session reuse, concurrent login requests, session expiry, retries, and upstream failures.



## 2. Assumptions and Engineering Decisions



I used an in-memory cache for meter export data to reduce repeated upstream requests. The cache TTL is configurable, with a default of ten minutes. I preserved the original energy timestamps because the portal does not provide timezone information. I also chose to represent blank or malformed export values explicitly rather than silently guessing missing information.



These decisions and the remaining uncertainties are documented in \[README.md](./README.md) and \[PROTOCOL.md](./PROTOCOL.md).



## 3. A Mistake I Made



During documentation work, I encountered formatting problems while copying commands and editing files. I corrected the affected files and checked their saved contents rather than assuming the edits had worked correctly. This taught me to verify generated documentation and configuration files before submission.



## 4. Limitations



Some upstream behavior remains unverified, particularly aspects of pagination and timestamp semantics. The automated tests cover important scenarios, but they do not replace integration testing against the live portal. The in-memory cache also does not share cached data between multiple server instances.



## 5. Self-Critique



Although the API has automated tests and consistent error handling, I would strengthen confidence in the implementation by testing more scenarios against the live portal. I would also investigate the unresolved protocol questions and assess whether the caching approach remains appropriate as the service scales.



## 6. What I Would Improve



With another day, I would first verify the remaining upstream behavior and timestamp semantics, then expand integration testing against the live portal. If the service needed to run across multiple instances, I would evaluate shared caching. I would also add further validation to ensure the documentation, examples, and OpenAPI specification stay consistent as the API evolves.



## 7. Use of AI Tools



I used Claude and ChatGPT for implementation guidance, debugging, code review, test planning, and documentation. I ran commands and automated tests locally and reviewed their outputs. I remain responsible for understanding and explaining the submitted implementation, its design decisions, and its limitations.
