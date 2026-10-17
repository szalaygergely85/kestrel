-- CONTENT-DB-01: read-only projections; edit the document column in content_<kind>.
CREATE VIEW placements_by_mesh AS
SELECT d.path, d.id AS world_id, p.key AS placement_index,
       json_extract(p.value, '$.id') AS placement_id,
       json_extract(p.value, '$.mesh') AS mesh, p.value AS placement
FROM _content_all AS d,
     json_each(d.document, '$.structures') AS p
WHERE json_type(p.value, '$.mesh') = 'text'
UNION ALL
SELECT d.path, d.id, p.key, json_extract(p.value, '$.id'),
       json_extract(p.value, '$.mesh'), p.value
FROM _content_all AS d, json_each(d.document, '$.props') AS p
WHERE json_type(p.value, '$.mesh') = 'text';

CREATE VIEW quests_by_region AS
SELECT d.path, json_extract(q.value, '$.id') AS quest_id,
       coalesce(json_extract(q.value, '$.region'),
         CASE WHEN json_extract(q.value, '$.site') GLOB 'relay_*'
              THEN substr(json_extract(q.value, '$.site'), 7)
              WHEN json_extract(q.value, '$.id') LIKE 'sq.reg.%'
              THEN substr(json_extract(q.value, '$.id'), 8) END) AS region,
       json_extract(q.value, '$.title') AS title, q.value AS quest
FROM _content_all AS d,
     json_each(CASE WHEN json_type(d.document, '$.quests') = 'array'
                    THEN json_extract(d.document, '$.quests')
                    ELSE json_array(json(d.document)) END) AS q
WHERE d.kind IN ('quest', 'quests');

CREATE VIEW loot_by_source AS
SELECT d.path, s.key AS source, s.value AS loot
FROM _content_all AS d, json_each(d.document, '$.sources') AS s
WHERE d.kind IN ('loot', 'items')
UNION ALL
SELECT d.path, s.key, s.value
FROM _content_all AS d, json_each(d.document, '$.tables') AS s
WHERE d.kind IN ('loot', 'items');
