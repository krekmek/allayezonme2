-- 007_rag_documents.sql
-- RAG: pgvector-таблица для хранения чанков приказов и их эмбеддингов.
-- Модель: Google Gemini text-embedding-004 (768 dim).

-- Расширение pgvector (в Supabase уже есть, нужно только активировать)
create extension if not exists vector;

-- Пересоздаём таблицу/индексы/RPC (dim мог измениться — безопаснее чистый старт).
drop table if exists public.rag_documents cascade;
drop function if exists public.match_rag_documents(vector, int);

-- Таблица чанков документов
create table public.rag_documents (
    id           bigserial primary key,
    source       text         not null,         -- "Приказ №76" и т.п.
    chunk_index  integer      not null,         -- порядковый номер чанка внутри документа
    content      text         not null,         -- сам текст чанка
    embedding    vector(768)  not null,         -- Gemini text-embedding-004
    created_at   timestamptz  not null default now()
);

create index rag_documents_source_idx
    on public.rag_documents (source);

-- IVFFlat индекс для cosine similarity
create index rag_documents_embedding_idx
    on public.rag_documents
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- RPC для семантического поиска (cosine similarity)
create or replace function public.match_rag_documents(
    query_embedding vector(768),
    match_count     int default 5
)
returns table (
    id          bigint,
    source      text,
    chunk_index integer,
    content     text,
    similarity  float
)
language sql stable
as $$
    select
        d.id,
        d.source,
        d.chunk_index,
        d.content,
        1 - (d.embedding <=> query_embedding) as similarity
    from public.rag_documents d
    order by d.embedding <=> query_embedding
    limit match_count;
$$;
