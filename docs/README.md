# docs/

Папка для PDF-приказов, которые будут загружены в RAG (таблица `document_chunks`
с эмбеддингами OpenAI `text-embedding-3-small`, 1536 dim).

## Куда класть файлы

Положите PDF сюда, например:

```
docs/
├── Приказ_130.pdf
├── Приказ_76.pdf
└── ...
```

## Как загрузить

Из корня проекта:

```bash
# Все PDF из этой папки
python scripts/ingest_docs.py

# Или конкретные файлы
python scripts/ingest_docs.py docs/Приказ_130.pdf docs/Приказ_76.pdf

# С перезаписью (удалит старые чанки того же файла)
python scripts/ingest_docs.py --replace docs/Приказ_130.pdf
```

## Что происходит при загрузке

1. `pypdf` извлекает текст из PDF постранично
2. `RecursiveCharacterTextSplitter` режет его на чанки 800 симв. с overlap 150
3. OpenAI Embeddings API генерирует вектор 1536d на каждый чанк
4. Чанки + метаданные (`source`, `decree_number`, `chunk_index`) пишутся в
   `document_chunks` в Supabase
