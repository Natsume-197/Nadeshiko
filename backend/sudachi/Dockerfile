# Sudachi sidecar for Nadeshiko's own parser (task 40). Pinned to the same SudachiDict release and checksum as
# docker/Dockerfile.elasticsearch: stored tokens and search tokens must come from one dictionary, so bump both
# together. SudachiPy stays on 0.6.x: 0.7 reads only the newer dictionary format, which analysis-sudachi 3.6
# does not.
FROM python:3.12-slim

RUN pip install --no-cache-dir sudachipy==0.6.10

ADD --checksum=sha256:2a1eda5a0240a42f45daf8003d97df5565c5d252bb2d58e71807bbbd082f7eea \
  https://github.com/WorksApplications/SudachiDict/releases/download/v20260116/sudachi-dictionary-20260116-full.zip \
  /tmp/sudachi-dict-full.zip
RUN python -c "import zipfile; zipfile.ZipFile('/tmp/sudachi-dict-full.zip').extractall('/tmp/sudachi-dict')" && \
  mkdir -p /sudachi && \
  mv /tmp/sudachi-dict/*/system_full.dic /sudachi/system_full.dic && \
  rm -rf /tmp/sudachi-dict-full.zip /tmp/sudachi-dict

# User dictionary (task 46): the upstream parser's Sudachi user dictionary without its JMnedict name rows (they
# changed no test sentence) and without the 481 rows our JMdict has no entry for (はずだ, お茶する: the word card
# would find nothing), compiled here against the system dictionary above. It adds JMdict words and expressions as
# single lexemes (あけましておめでとうございます, ながもの), so the combine stages see the cuts upstream's rules were
# written for. Derived from JMdict (CC BY-SA), credited on the Sources page.
COPY user_dic.csv.gz /tmp/user_dic.csv.gz
RUN python -c "import gzip, shutil; shutil.copyfileobj(gzip.open('/tmp/user_dic.csv.gz'), open('/tmp/user_dic.csv', 'wb'))" && \
  sudachipy ubuild -s /sudachi/system_full.dic -o /sudachi/user.dic /tmp/user_dic.csv && \
  rm -f /tmp/user_dic.csv /tmp/user_dic.csv.gz

COPY server.py /app/server.py

ENV SUDACHI_DICTIONARY=/sudachi/system_full.dic \
    SUDACHI_USER_DICTIONARIES=/sudachi/user.dic \
    SUDACHI_DICTIONARY_VERSION=20260116-full-user2 \
    PORT=8090
EXPOSE 8090
USER nobody
CMD ["python", "/app/server.py"]
