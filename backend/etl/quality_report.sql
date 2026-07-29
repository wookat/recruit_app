-- Data quality report for positions. Run: psql <DB> -f backend/etl/quality_report.sql

\echo '== row counts =='
SELECT count(*) AS total,
       count(*) FILTER (WHERE dup_of_id IS NOT NULL) AS duplicates,
       count(*) FILTER (WHERE invalid_reason IS NOT NULL) AS invalid,
       count(*) FILTER (WHERE dup_of_id IS NULL AND invalid_reason IS NULL) AS clean
FROM positions;

\echo '== job_type =='
SELECT job_type, count(*) FROM positions GROUP BY 1 ORDER BY 2 DESC;

\echo '== exam_type_norm =='
SELECT exam_type_norm, count(*) FROM positions GROUP BY 1 ORDER BY 2 DESC;

\echo '== edu_level_norm =='
SELECT edu_level_norm, count(*) FROM positions GROUP BY 1 ORDER BY 2 DESC;

\echo '== location coverage =='
SELECT count(*) FILTER (WHERE province IS NOT NULL) AS has_province,
       count(*) FILTER (WHERE city IS NOT NULL) AS has_city,
       count(*) FILTER (WHERE district IS NOT NULL) AS has_district,
       count(*) FILTER (WHERE province IS NULL) AS no_province
FROM positions;

\echo '== unresolved locations (top 20) =='
SELECT work_location, count(*) FROM positions
WHERE province IS NULL AND work_location IS NOT NULL AND work_location <> ''
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

\echo '== major fields =='
SELECT count(*) FILTER (WHERE undergrad_major IS NOT NULL) AS has_ug,
       count(*) FILTER (WHERE grad_major IS NOT NULL) AS has_grad,
       count(*) FILTER (WHERE college_major IS NOT NULL) AS has_college,
       count(*) FILTER (WHERE undergrad_major ~ '研究生专业要求') AS unsplit_blob
FROM positions;

\echo '== invalid breakdown =='
SELECT invalid_reason, count(*) FROM positions WHERE invalid_reason IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;

\echo '== duplicate breakdown by source domain =='
SELECT substring(source_url FROM '^https?://([^/]+)') AS domain,
       count(*) AS total, count(*) FILTER (WHERE dup_of_id IS NOT NULL) AS dups
FROM positions GROUP BY 1 ORDER BY 2 DESC;
