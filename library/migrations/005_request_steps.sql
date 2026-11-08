create table if not exists request_steps 
(
    id bigint generated always as identity primary key,
    request_id bigint not null references requests(id),
    seq int not null, -- order within the request
    node text not null check (node in ('rewrite','retrieve','grade','webSearch','answer')),
    attempt int not null,
    detail jsonb not null default '{}',
    input_tokens int not null default 0,
    output_tokens int not null default 0,
    latency_ms int not null,
    unique(request_id,seq)
);