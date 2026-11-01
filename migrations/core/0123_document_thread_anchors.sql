-- Issue-owned document quotes retain their exact source identity with the thread.
-- Applied source edits preserve offsets or mark the retained quote removed.
ALTER TABLE issue_comments ADD COLUMN document_anchor TEXT CHECK(document_anchor IS NULL OR json_valid(document_anchor));

CREATE TRIGGER issue_document_anchors_changed AFTER UPDATE OF body ON documents
WHEN NEW.body <> OLD.body
BEGIN
  UPDATE issue_comments SET document_anchor = (
    -- Binary searches find the unchanged prefix and suffix without scanning
    -- once per source character. Suffixes never overlap the common prefix.
    WITH RECURSIVE
    prefix(lo,hi) AS (
      SELECT 0,min(length(OLD.body),length(NEW.body))
      UNION ALL
      SELECT CASE WHEN substr(OLD.body,1,(lo+hi+1)/2)=substr(NEW.body,1,(lo+hi+1)/2) THEN (lo+hi+1)/2 ELSE lo END,
             CASE WHEN substr(OLD.body,1,(lo+hi+1)/2)=substr(NEW.body,1,(lo+hi+1)/2) THEN hi ELSE (lo+hi+1)/2-1 END
      FROM prefix WHERE lo<hi
    ),
    p(n) AS (SELECT lo FROM prefix WHERE lo=hi),
    suffix(lo,hi) AS (
      SELECT 0,min(length(OLD.body),length(NEW.body))-(SELECT n FROM p)
      UNION ALL
      SELECT CASE WHEN substr(OLD.body,length(OLD.body)-(lo+hi+1)/2+1)=substr(NEW.body,length(NEW.body)-(lo+hi+1)/2+1) THEN (lo+hi+1)/2 ELSE lo END,
             CASE WHEN substr(OLD.body,length(OLD.body)-(lo+hi+1)/2+1)=substr(NEW.body,length(NEW.body)-(lo+hi+1)/2+1) THEN hi ELSE (lo+hi+1)/2-1 END
      FROM suffix WHERE lo<hi
    ),
    bounds(a,b,delta) AS (SELECT p.n,length(OLD.body)-suffix.lo,length(NEW.body)-length(OLD.body) FROM p,suffix WHERE suffix.lo=suffix.hi)
    , quote(source,at) AS (SELECT substr(OLD.body,json_extract(document_anchor,'$.start')+1,json_extract(document_anchor,'$.end')-json_extract(document_anchor,'$.start')),json_extract(document_anchor,'$.start')+1),
    located(source,oldAt,newAt) AS (SELECT source,at,instr(NEW.body,source) FROM quote)
    SELECT CASE
      WHEN json_extract(document_anchor,'$.end')<=a THEN document_anchor
      WHEN json_extract(document_anchor,'$.start')>=b THEN json_set(document_anchor,
        '$.start',json_extract(document_anchor,'$.start')+delta,
        '$.end',json_extract(document_anchor,'$.end')+delta)
      -- An unchanged, unique source quote can survive edits on both sides.
      -- Ambiguous repeated text never jumps to another occurrence.
      WHEN newAt>0 AND instr(OLD.body,source)=oldAt
        AND instr(substr(OLD.body,oldAt+length(source)),source)=0
        AND instr(substr(NEW.body,newAt+length(source)),source)=0
      THEN json_set(document_anchor,'$.start',newAt-1,'$.end',newAt-1+length(source))
      ELSE json_set(document_anchor,'$.removed',json('true')) END FROM bounds,located
  ) WHERE document_anchor IS NOT NULL AND json_extract(document_anchor,'$.documentId')=NEW.id AND json_extract(document_anchor,'$.removed')=0;
END;

CREATE TRIGGER issue_comment_document_anchor_deleted AFTER UPDATE OF deleted_at ON issue_comments
WHEN NEW.deleted_at IS NOT NULL AND NEW.document_anchor IS NOT NULL
BEGIN
  UPDATE issue_comments SET document_anchor=NULL WHERE id=NEW.id;
END;
