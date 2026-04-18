-- 014_document_chunks.sql
-- RAG для приказов: хранение чанков PDF-документов с эмбеддингами OpenAI.
-- Модель: text-embedding-3-small (1536 dim).
-- Параллельно существующей rag_documents (Gemini 768 dim) — это отдельная таблица
-- с более качественной моделью OpenAI.

-- Расширение pgvector (в Supabase уже доступно)
create extension if not exists vector;

-- Таблица чанков документов
create table if not exists public.document_chunks (
    id           bigserial primary key,
    content      text          not null,           -- текст чанка
    metadata     jsonb         not null default '{}'::jsonb,
                                                    -- {"source": "Приказ_130.pdf", "decree_number": "130",
                                                    --  "chunk_index": 3, "total_chunks": 12}
    embedding    vector(1536)  not null,           -- OpenAI text-embedding-3-small
    created_at   timestamptz   not null default now()
);

-- Индекс по source для быстрой фильтрации/удаления по файлу
create index if not exists document_chunks_source_idx
    on public.document_chunks ((metadata->>'source'));

create index if not exists document_chunks_decree_idx
    on public.document_chunks ((metadata->>'decree_number'));

-- IVFFlat индекс для cosine similarity
create index if not exists document_chunks_embedding_idx
    on public.document_chunks
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- RPC для семантического поиска
create or replace function public.match_document_chunks(
    query_embedding vector(1536),
    match_count     int default 5,
    filter_source   text default null
)
returns table (
    id          bigint,
    content     text,
    metadata    jsonb,
    similarity  float
)
language sql stable
as $$
    select
        d.id,
        d.content,
        d.metadata,
        1 - (d.embedding <=> query_embedding) as similarity
    from public.document_chunks d
    where filter_source is null
       or d.metadata->>'source' = filter_source
    order by d.embedding <=> query_embedding
    limit match_count;
$$;

comment on table public.document_chunks is
    'Чанки PDF-приказов с эмбеддингами OpenAI (1536) для RAG-поиска.';
