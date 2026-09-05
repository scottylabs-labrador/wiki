# Wiki Agent

A chat agent that answers questions about ScottyLabs Labrador using the committee's published documentation as its only source of truth.

## Language

**Source**:
A website whose documentation the agent is allowed to answer from, such as the ScottyStack wiki.
_Avoid_: Site, wiki, website

**Page**:
A single document within a Source, identified by a stable public URL that a reader can open.
_Avoid_: Article, doc, entry

**Chunk**:
A passage of a Page small enough to be retrieved on its own, and the smallest unit the agent can cite.
_Avoid_: Segment, fragment, section, block

**Corpus**:
Every Page across every Source, as most recently ingested.
_Avoid_: Knowledge base, index, dataset

**Answer**:
One model response to one question, together with the Citations that support it.
_Avoid_: Reply, completion, message

**Citation**:
A link to the section of a Page that an Answer drew on. An Answer that no Page supports has none.
_Avoid_: Reference, source link, footnote
